// SUIT — browser client for the Nova arbitrary-amount UTXO pool (v3).
//
// Deposit any amount. Withdraw any portion. Change returned as a new note.
// All proven in zero-knowledge (Groth16 BN254) — the chain sees only roots,
// nullifiers, and commitments; never which deposit funds which withdrawal.
//
// The Merkle tree is GLOBAL and on-chain. This client reconstructs the full
// leaf set from the pool's `transact` events (each carries its output
// commitments + leaf index), so roots/paths always match the chain even with
// many depositors. Local storage holds only the secret note material.

import {
  rpc,
  Horizon,
  Asset,
  Operation,
  TransactionBuilder,
  Contract,
  Address,
  Keypair,
  xdr,
  scValToNative,
  nativeToScVal,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { isConnected, requestAccess, getAddress, signTransaction } from '@stellar/freighter-api';
import { poseidon1, poseidon2, poseidon3 } from 'poseidon-lite';
import { keccak256 } from 'js-sha3';

// Network-wide constants (shared by every token pool).
export const CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  network: Networks.TESTNET,
  verifierId: 'CDEZRSL6WXBEJZ45WVFDI6DIHJEZ6UEWY3CUJIQPLCQIVUMLXXVKON2T',
  depth: 16,
  decimals: 7,
  explorer: 'https://stellar.expert/explorer/testnet',
  // Relayer endpoint (Vercel serverless fn). Override in dev with VITE_RELAYER_URL.
  relayerUrl: (import.meta as any).env?.VITE_RELAYER_URL || '/api/relay',
};

// Each token is just a second deployment of the same asset-agnostic pool.
export type TokenSym = 'XLM' | 'USDC';
export interface TokenInfo {
  sym: TokenSym;
  label: string;
  poolId: string;
  tokenId: string;    // Stellar Asset Contract (SAC) address
  startLedger: number; // events scanned from here
  issuer?: string;     // classic issuer (USDC faucet / trustline)
  assetCode?: string;
}
export const TOKENS: Record<TokenSym, TokenInfo> = {
  XLM: {
    sym: 'XLM', label: 'XLM',
    poolId: 'CDGGJTTWSOGHKO6GCZTZQUIO4U2Y5PUQOSAWESGUUC74QUXDHGIPPX6X',
    tokenId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    startLedger: 3239820,
  },
  USDC: {
    sym: 'USDC', label: 'USDC',
    poolId: 'CARK2WXVBDREA3ARTCGCRHHDXDG4YXSZSU52QIL6BPVPRBV6TTJXD4GS',
    tokenId: 'CDCFQVDHKVOMLF237VYGKFTBYWBUGC73IU233CDQ7SPNFKGXWWALMASU',
    startLedger: 3239960,
    issuer: 'GDA3FKYJLOOOUI7UF6JHVMZPTKHFJT7BWZWIMACU7EDE75ALI5IVJTWL',
    assetCode: 'USDC',
  },
};

let activeSym: TokenSym = 'XLM';
try { const s = localStorage.getItem('suit_token'); if (s === 'XLM' || s === 'USDC') activeSym = s; } catch { /* ssr */ }
export function getActiveToken(): TokenInfo { return TOKENS[activeSym]; }
export function getActiveSym(): TokenSym { return activeSym; }
export function setActiveToken(s: TokenSym) {
  activeSym = s;
  try { localStorage.setItem('suit_token', s); } catch { /* ignore */ }
  leafCacheMem = null; // different pool → different tree
}

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const STROOPS = 10n ** BigInt(CONFIG.decimals);
const server = new rpc.Server(CONFIG.rpcUrl);

// ── byte helpers ──
function randomField(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v % P;
}
function be(v: bigint, n = 32): Uint8Array {
  let x = ((v % P) + P) % P;
  const o = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o;
}
function beRaw(v: bigint, n = 32): Uint8Array {
  let x = v;
  const o = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o;
}
function bytesToBig(b: Uint8Array | number[] | Buffer): bigint {
  let v = 0n;
  for (const x of b as Uint8Array) v = (v << 8n) | BigInt(x);
  return v;
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, x) => s + x.length, 0);
  const o = new Uint8Array(len);
  let p = 0;
  for (const x of arrs) { o.set(x, p); p += x.length; }
  return o;
}
const scvBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b));

export function xlmToStroops(xlm: string): bigint {
  const parts = xlm.split('.');
  const whole = BigInt(parts[0] || '0');
  const frac = (parts[1] || '').padEnd(CONFIG.decimals, '0').slice(0, CONFIG.decimals);
  return whole * STROOPS + BigInt(frac);
}
export function stroopsToXlm(stroops: bigint | string): string {
  const s = BigInt(stroops);
  const whole = s / STROOPS;
  const frac = s % STROOPS;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(CONFIG.decimals, '0').replace(/0+$/, '')}`;
}

// ── Poseidon (BN254, matches circomlib exactly) ──
const pubKeyOf = (priv: bigint) => poseidon1([priv]);
const commitHash = (amount: bigint, pk: bigint, blinding: bigint) => poseidon3([amount, pk, blinding]);
const signHash = (priv: bigint, commitment: bigint, idx: bigint) => poseidon3([priv, commitment, idx]);
const nullHash = (commitment: bigint, idx: bigint, sig: bigint) => poseidon3([commitment, idx, sig]);

// ── Merkle tree (depth-16 Poseidon, identical to on-chain) ──
const ZEROS: bigint[] = [0n];
for (let i = 1; i <= CONFIG.depth; i++) ZEROS.push(poseidon2([ZEROS[i - 1], ZEROS[i - 1]]));

function treeRoot(leaves: bigint[]): bigint {
  if (leaves.length === 0) return ZEROS[CONFIG.depth];
  let layer = leaves.slice();
  for (let d = 0; d < CONFIG.depth; d++) {
    const next: bigint[] = [];
    const len = Math.max(layer.length, 1);
    for (let i = 0; i < len; i += 2) {
      const l = i < layer.length ? layer[i] : ZEROS[d];
      const r = i + 1 < layer.length ? layer[i + 1] : ZEROS[d];
      next.push(poseidon2([l, r]));
    }
    layer = next;
  }
  return layer[0];
}
function treePath(index: number, leaves: bigint[]): bigint[] {
  const path: bigint[] = [];
  let layer = leaves.slice();
  let idx = index;
  for (let d = 0; d < CONFIG.depth; d++) {
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    path.push(sib >= 0 && sib < layer.length ? layer[sib] : ZEROS[d]);
    const next: bigint[] = [];
    const len = Math.max(layer.length, 1);
    for (let i = 0; i < len; i += 2) {
      const l = i < layer.length ? layer[i] : ZEROS[d];
      const r = i + 1 < layer.length ? layer[i + 1] : ZEROS[d];
      next.push(poseidon2([l, r]));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return path;
}
function emptyPath(): string[] {
  return ZEROS.slice(0, CONFIG.depth).map(z => z.toString());
}

// ── on-chain leaf sync (the global tree, rebuilt from transact events) ──
//
// Leaves are indexed by their absolute on-chain leaf index (from the event), so
// a partial event window still merges correctly. We persist the reconstructed
// set to localStorage and merge new events on top — the tree therefore survives
// even after old events age out of the RPC's finite event-retention window.
// Namespaced by pool id so a previous pool deployment's cache (or the other
// token's pool) never poisons the active one.
const leafKey = () => `suit_leafcache_${getActiveToken().poolId.slice(0, 8)}`;
let leafCacheMem: bigint[] | null = null;

function loadLeafCache(): Map<number, bigint> {
  const m = new Map<number, bigint>();
  try {
    const raw = JSON.parse(localStorage.getItem(leafKey()) || '{}');
    for (const k of Object.keys(raw)) m.set(Number(k), BigInt(raw[k]));
  } catch { /* ignore */ }
  return m;
}
function saveLeafCache(m: Map<number, bigint>) {
  const obj: Record<string, string> = {};
  for (const [k, v] of m) obj[k] = v.toString();
  localStorage.setItem(leafKey(), JSON.stringify(obj));
}

export async function syncLeaves(force = false): Promise<bigint[]> {
  if (leafCacheMem && !force) return leafCacheMem;

  const indexed = loadLeafCache();
  const filters = [{ type: 'contract' as const, contractIds: [getActiveToken().poolId], topics: [['*']] }];

  // Clamp start to the RPC's retention window to avoid "startLedger too old" errors;
  // any leaves older than the window are already preserved in the local cache.
  let start = getActiveToken().startLedger;
  try {
    const latest = (await server.getLatestLedger()).sequence;
    const minStart = latest - 16000;
    if (start < minStart) start = minStart;
  } catch { /* use configured start */ }

  const collect = (events: any[]) => {
    for (const e of events) {
      try {
        const data: any = scValToNative(e.value);
        if (data && typeof data.leaf_index !== 'undefined' && data.out_commitment_0) {
          const idx = Number(data.leaf_index);
          indexed.set(idx, bytesToBig(data.out_commitment_0));
          indexed.set(idx + 1, bytesToBig(data.out_commitment_1));
        }
      } catch { /* not a transact event */ }
    }
  };

  let res = await server.getEvents({ startLedger: start, filters, limit: 200 });
  collect(res.events);
  while (res.events.length === 200 && (res as any).cursor) {
    res = await server.getEvents({ filters, limit: 200, cursor: (res as any).cursor } as any);
    collect(res.events);
  }

  saveLeafCache(indexed);
  const maxIdx = indexed.size ? Math.max(...indexed.keys()) : -1;
  const leaves: bigint[] = [];
  for (let i = 0; i <= maxIdx; i++) leaves.push(indexed.get(i) ?? ZEROS[0]);
  leafCacheMem = leaves;
  return leaves;
}

// ── UTXO note store (secrets only; tree comes from chain) ──
export interface UTXONote {
  amount: string;
  privKey: string;
  blinding: string;
  commitment: string; // decimal
  leafIndex: number;   // best-effort cache; re-derived from chain on spend
  spent: boolean;
  txHash: string;
  ts: number;
}

const notesKey = () => `suit_notes_${getActiveToken().poolId.slice(0, 8)}`;

export function getNotes(): UTXONote[] {
  try { return JSON.parse(localStorage.getItem(notesKey()) || '[]'); } catch { return []; }
}
function saveNotes(n: UTXONote[]) { localStorage.setItem(notesKey(), JSON.stringify(n)); }

// ── proof helpers ──
function dummyInput() {
  const priv = randomField(), blinding = randomField();
  const c = commitHash(0n, pubKeyOf(priv), blinding);
  const sig = signHash(priv, c, 0n);
  return { priv, blinding, nullifier: nullHash(c, 0n, sig), pathElements: emptyPath() };
}
function encodeProof(proof: any): Uint8Array {
  const g1 = (p: string[]) => concat([beRaw(BigInt(p[0])), beRaw(BigInt(p[1]))]);
  const g2 = (p: string[][]) =>
    concat([beRaw(BigInt(p[0][1])), beRaw(BigInt(p[0][0])), beRaw(BigInt(p[1][1])), beRaw(BigInt(p[1][0]))]);
  return concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]);
}
const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

// ── recipient binding ──
//
// The proof commits to where the money goes. We compute the SAME field element
// the pool recomputes on-chain: keccak256(recipient_xdr ‖ relayer_xdr ‖ fee_be),
// keeping the low 31 bytes (always < the BN254 scalar field, no modular reduction
// — matches compute_ext_hash() in pool_v3/src/lib.rs byte-for-byte, verified by
// scripts/diag_exthash.js). Because this is a public input to the proof, a relayer
// (or anyone who sees the proof) cannot re-point the funds without invalidating it.
function extDataHashField(recipient: string, relayer: string, fee: bigint): bigint {
  const rb = new Uint8Array(new Address(recipient).toScVal().toXDR());
  const lb = new Uint8Array(new Address(relayer).toScVal().toXDR());
  const fb = beRaw(fee, 16); // i128 big-endian (fee ≥ 0)
  const d = new Uint8Array(keccak256.arrayBuffer(concat([rb, lb, fb])));
  return bytesToBig(d.slice(1)); // low 31 bytes
}

// ── relayer client ──
export interface RelayerInfo { relayer: string; fee: string; }
/** Ask the relayer for its public key + fee, or null if it's offline. */
export async function getRelayerInfo(): Promise<RelayerInfo | null> {
  try {
    const r = await fetch(CONFIG.relayerUrl, { method: 'GET' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.relayer === 'string' ? { relayer: j.relayer, fee: String(j.fee ?? '0') } : null;
  } catch { return null; }
}
interface RelayBundle {
  poolId: string; proof: string; root: string; extAmount: string;
  nullifiers: string[]; commitments: string[]; recipient: string; fee: string;
}
async function relaySubmit(body: RelayBundle): Promise<string> {
  const r = await fetch(CONFIG.relayerUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || j.error) throw new Error(j.error || `Relayer error (${r.status})`);
  if (!j.hash) throw new Error('Relayer returned no transaction hash.');
  return j.hash as string;
}

// ── wallet ──
export async function connectWallet(): Promise<string> {
  const c = await isConnected();
  if (!(c as any).isConnected) throw new Error('Freighter not detected.');
  const a = await requestAccess();
  if ((a as any).error) throw new Error((a as any).error);
  return (a as any).address as string;
}
export async function getWalletAddress(): Promise<string | null> {
  try {
    const c = await isConnected();
    if (!(c as any).isConnected) return null;
    const a = await getAddress();
    return (a as any).address || null;
  } catch { return null; }
}

/** Native XLM balance (whole units, 7-dp string) via Horizon. */
export async function getXlmBalance(address: string): Promise<string> {
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
  if (!res.ok) {
    if (res.status === 404) return '0';
    throw new Error(`Balance lookup failed (${res.status})`);
  }
  const data = await res.json();
  const native = (data.balances || []).find((b: any) => b.asset_type === 'native');
  return native ? native.balance : '0';
}

/** Classic balance of the active token's underlying asset (the wallet's spendable,
 *  un-shielded balance). XLM → native; USDC → the issuer trustline (0 if none). */
export async function getWalletTokenBalance(address: string): Promise<string> {
  const tok = getActiveToken();
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
  if (!res.ok) return '0';
  const data = await res.json();
  if (tok.sym === 'XLM') {
    const n = (data.balances || []).find((b: any) => b.asset_type === 'native');
    return n ? n.balance : '0';
  }
  const t = (data.balances || []).find((b: any) => b.asset_code === tok.assetCode && b.asset_issuer === tok.issuer);
  return t ? t.balance : '0';
}

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

/** One-click test-USDC: add the issuer trustline (signed in Freighter), then pull
 *  funds from the faucet so the user can try the shielded USDC pool. */
export async function enableAndFundUSDC(address: string, onStep?: (m: string) => void): Promise<void> {
  const tok = TOKENS.USDC;
  if (!tok.issuer || !tok.assetCode) throw new Error('USDC not configured.');
  address = (await getWalletAddress()) || address;

  const horizon = new Horizon.Server(HORIZON_URL);
  const asset = new Asset(tok.assetCode, tok.issuer);

  // Add the trustline only if missing (re-adding is harmless but costs a signature).
  const acct = await horizon.loadAccount(address);
  const hasTrust = (acct.balances || []).some((b: any) => b.asset_code === tok.assetCode && b.asset_issuer === tok.issuer);
  if (!hasTrust) {
    onStep?.('Approve the USDC trustline in Freighter…');
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: CONFIG.network })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(120).build();
    const signed = await signTransaction(tx.toXDR(), { networkPassphrase: CONFIG.network, address });
    if ((signed as any).error) throw new Error((signed as any).error.message || String((signed as any).error));
    const xdrStr = (signed as any).signedTxXdr;
    if (!xdrStr) throw new Error('Trustline was not signed.');
    onStep?.('Adding trustline…');
    await horizon.submitTransaction(TransactionBuilder.fromXDR(xdrStr, CONFIG.network) as any);
  }

  onStep?.('Requesting test USDC from the faucet…');
  const r = await fetch('/api/faucet', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }),
  });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || j.error) throw new Error(j.error || `Faucet error (${r.status})`);
  onStep?.(`Received ${j.amount || ''} test USDC.`);
}

// ── tx submission ──
//
// txBadAuth post-mortem: a withdraw signed by Freighter was rejected at the
// classic layer (bad envelope signature) even though the *identical* assembled
// transaction submits fine when signed by a raw keypair, the contract/tx are
// correct, and an XDR round-trip is byte-for-byte lossless. The only way that
// happens: the signature Freighter returns does not match the hash of the
// envelope we submit — i.e. the wallet re-encodes/re-builds the transaction and
// signs a hash other than the one in the bytes it hands back.
//
// So we stop trusting the returned envelope blindly. We take the signature(s)
// Freighter produced and verify them, with the source account's public key,
// against BOTH candidate hashes: the transaction we asked it to sign (`prepared`)
// and the transaction it returned (`returned`). We then submit *exactly* the
// transaction the signature actually authenticates — reattaching the signature
// to `prepared` when the wallet handed back a differently-encoded envelope. If
// no signature validates against either, we throw a precise error instead of
// letting the network return an opaque txBadAuth.
async function signAndSend(
  address: string,
  op: xdr.Operation,
  onStep?: (m: string) => void,
): Promise<string> {
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 1000).toString(),
    networkPassphrase: CONFIG.network,
  }).addOperation(op).setTimeout(300).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation: ${sim.error}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const preparedHash = prepared.hash();

  const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: CONFIG.network, address });
  if ((signed as any).error) {
    const e = (signed as any).error;
    throw new Error(typeof e === 'string' ? e : (e.message || JSON.stringify(e)));
  }
  const xdrStr = (signed as any).signedTxXdr;
  if (!xdrStr) throw new Error('Wallet returned no signed transaction.');

  const returned = TransactionBuilder.fromXDR(xdrStr, CONFIG.network) as any;
  const returnedHash = returned.hash();
  const sigs = returned.signatures || [];
  if (sigs.length === 0) {
    throw new Error('Freighter returned an unsigned transaction. Unlock it, make sure it is set to Testnet, and approve the signing prompt.');
  }

  const srcKp = Keypair.fromPublicKey(address);
  let toSubmit: any = null;
  for (const ds of sigs) {
    const sigBuf = ds.signature();
    if (srcKp.verify(returnedHash, sigBuf)) { toSubmit = returned; break; }
    if (srcKp.verify(preparedHash, sigBuf)) {
      // Wallet signed the tx we sent but handed back a re-encoded envelope —
      // reattach the valid signature to the original and submit that one.
      onStep?.('Repairing wallet signature (envelope re-encode)…');
      prepared.signatures.push(ds);
      toSubmit = prepared;
      break;
    }
  }
  if (!toSubmit) {
    // The signature doesn't match the (correct) testnet hash of an unmodified
    // envelope. Pin the real cause: wrong account, wrong network, or a wallet
    // re-simulation divergence — and tell the user exactly what to fix.
    const srcHint = Keypair.fromPublicKey(address).rawPublicKey().slice(-4).toString('hex').toUpperCase();
    const sigHints = sigs.map((ds: any) => Buffer.from(ds.hint()).toString('hex').toUpperCase());
    const hintMatches = sigHints.includes(srcHint);

    let signedForNetwork = '';
    for (const [label, pass] of [['Mainnet (Public)', Networks.PUBLIC], ['Futurenet', 'Test SDF Future Network ; October 2022']] as [string, string][]) {
      const h = (TransactionBuilder.fromXDR(returned.toXDR(), pass) as any).hash();
      if (sigs.some((ds: any) => srcKp.verify(h, ds.signature()))) { signedForNetwork = label; break; }
    }

    const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
    if (!hintMatches) {
      throw new Error(
        `Freighter signed with a different account (key …${sigHints[0] || '????'}) than this transaction's source (…${srcHint}). ` +
        `Open Freighter, switch the active account to ${short}, and retry. ` +
        `If you have multiple wallet extensions, make sure Freighter — not another wallet — handled the prompt.`,
      );
    }
    if (signedForNetwork) {
      throw new Error(
        `Freighter signed this for ${signedForNetwork}, but the pool is on Testnet. ` +
        `Open Freighter → network dropdown → select "Test Net", then retry.`,
      );
    }
    throw new Error(
      `Freighter's signature matches your account but no known network for this exact transaction ` +
      `(hash ${preparedHash.toString('hex').slice(0, 12)}). This is a Freighter signing divergence — ` +
      `update Freighter to the latest version and retry; if it persists, report this hash.`,
    );
  }

  const sent = await server.sendTransaction(toSubmit);
  if (sent.status === 'ERROR') throw new Error(`Submit: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Failed on-chain (${sent.hash}) — ${JSON.stringify((got as any).resultXdr?.result?.()?.switch?.()?.name ?? 'see explorer')}`);
    }
  }
  throw new Error('Not confirmed in time');
}

// ── pool queries ──
async function callView(method: string): Promise<any> {
  const addr = await getWalletAddress();
  if (!addr) return null;
  const contract = new Contract(getActiveToken().poolId);
  const account = await server.getAccount(addr);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: CONFIG.network })
    .addOperation(contract.call(method)).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result) return null;
  return scValToNative(sim.result.retval);
}
export async function getPoolCount(): Promise<number> {
  try { return Number(await callView('get_count')) || 0; } catch { return 0; }
}

// ── actions ──

export async function shield(
  address: string,
  amountXLM: string,
  onStep?: (m: string) => void,
): Promise<{ txHash: string; note: UTXONote }> {
  const amt = xlmToStroops(amountXLM);
  if (amt <= 0n) throw new Error('Amount must be positive');

  // Use Freighter's *current* active account as the funds source/signer, so a
  // stale UI address can't desync the tx source from whoever signs the prompt.
  address = (await getWalletAddress()) || address;

  const snarkjs = await import('snarkjs');
  onStep?.('Reading pool state…');

  // Deposit inputs are dummies (zero amount), so the proof's root is unconstrained;
  // the contract only checks the root is known, so use the current on-chain root.
  const countBefore = await getPoolCount();
  const rootNative = await callView('get_root');
  const root = rootNative ? bytesToBig(rootNative) : ZEROS[CONFIG.depth];

  onStep?.('Generating secret note…');
  const priv = randomField(), blinding = randomField();
  const pk = pubKeyOf(priv);
  const outCommit = commitHash(amt, pk, blinding);
  const dPriv = randomField(), dBlind = randomField();
  const dPk = pubKeyOf(dPriv);
  const dummyCommit = commitHash(0n, dPk, dBlind);
  const inA = dummyInput(), inB = dummyInput();

  // Deposit binds (recipient, relayer, fee) = (self, self, 0): there is no payout,
  // but the hash must still match what the contract recomputes for the proof to verify.
  const extHash = extDataHashField(address, address, 0n);

  onStep?.('Generating zero-knowledge proof… (~30 s)');
  const { proof } = await snarkjs.groth16.fullProve({
    root: root.toString(),
    publicAmount: amt.toString(),
    extDataHash: extHash.toString(),
    inputNullifier: [inA.nullifier.toString(), inB.nullifier.toString()],
    outputCommitment: [outCommit.toString(), dummyCommit.toString()],
    inAmount: ['0', '0'],
    inPrivateKey: [inA.priv.toString(), inB.priv.toString()],
    inBlinding: [inA.blinding.toString(), inB.blinding.toString()],
    inPathIndices: ['0', '0'],
    inPathElements: [inA.pathElements, inB.pathElements],
    outAmount: [amt.toString(), '0'],
    outPubkey: [pk.toString(), dPk.toString()],
    outBlinding: [blinding.toString(), dBlind.toString()],
  }, '/circuit-tx/Transaction.wasm', '/circuit-tx/Transaction_final.zkey');

  onStep?.('Submitting to Stellar…');
  const contract = new Contract(getActiveToken().poolId);
  const op = contract.call(
    'transact',
    scvBytes(encodeProof(proof)),
    scvBytes(be(root)),
    nativeToScVal(amt, { type: 'i128' }),
    xdr.ScVal.scvVec([scvBytes(be(inA.nullifier)), scvBytes(be(inB.nullifier))]),
    xdr.ScVal.scvVec([scvBytes(be(outCommit)), scvBytes(be(dummyCommit))]),
    new Address(address).toScVal(), // account (funds source, signer)
    new Address(address).toScVal(), // recipient (unused on deposit)
    new Address(address).toScVal(), // relayer (bound; no fee on deposit)
    nativeToScVal(0n, { type: 'i128' }), // fee
  );
  const txHash = await signAndSend(address, op, onStep);
  leafCacheMem = null; // invalidate; tree changed

  const note: UTXONote = {
    amount: amt.toString(), privKey: priv.toString(), blinding: blinding.toString(),
    commitment: outCommit.toString(), leafIndex: countBefore, spent: false, txHash, ts: Date.now(),
  };
  saveNotes([...getNotes(), note]);
  return { txHash, note };
}

export async function withdraw(
  address: string,
  note: UTXONote,
  amountXLM: string,
  recipient: string,
  onStep?: (m: string) => void,
): Promise<{ txHash: string; changeNote: UTXONote | null }> {
  const wAmt = xlmToStroops(amountXLM);
  const nAmt = BigInt(note.amount);
  if (wAmt <= 0n) throw new Error('Amount must be positive');
  if (wAmt > nAmt) throw new Error('Exceeds note balance');

  // Submit/sign with Freighter's *current* active account (the note's secret is
  // independent of who submits), so source and signer can't desync.
  address = (await getWalletAddress()) || address;

  // Prefer a relayer: it submits the withdrawal from ITS account, so the user's
  // wallet never appears on-chain (sender anonymity). The relayer is non-custodial
  // — the proof binds (recipient, relayer, fee), so it cannot redirect the funds.
  // If the relayer is offline we fall back to self-submit (visible, but still works).
  onStep?.('Contacting relayer…');
  const relayerInfo = await getRelayerInfo();
  const useRelayer = !!relayerInfo;
  const relayerAddr = relayerInfo?.relayer || address;
  const fee = useRelayer ? BigInt(relayerInfo!.fee || '0') : 0n;
  if (fee < 0n || fee > wAmt) throw new Error('Relayer fee out of range.');

  const snarkjs = await import('snarkjs');
  onStep?.('Syncing pool tree from chain…');

  const leaves = await syncLeaves(true);
  const commitment = BigInt(note.commitment);
  const leafIndex = leaves.findIndex(l => l === commitment);
  if (leafIndex < 0) throw new Error('Note not found in on-chain tree yet — wait for the deposit to index, then retry.');

  const root = treeRoot(leaves);
  const path = treePath(leafIndex, leaves);

  const priv = BigInt(note.privKey);
  const sig = signHash(priv, commitment, BigInt(leafIndex));
  const null0 = nullHash(commitment, BigInt(leafIndex), sig);
  const inDummy = dummyInput();

  const changeAmt = nAmt - wAmt;
  const cPriv = randomField(), cBlind = randomField();
  const changeCommit = commitHash(changeAmt, pubKeyOf(cPriv), cBlind);
  const zPriv = randomField(), zBlind = randomField();
  const zeroCommit = commitHash(0n, pubKeyOf(zPriv), zBlind);

  const publicAmount = (P - wAmt) % P;

  // Bind the proof to exactly this (recipient, relayer, fee).
  const extHash = extDataHashField(recipient, relayerAddr, fee);

  onStep?.('Generating zero-knowledge proof… (~30 s)');
  const { proof } = await snarkjs.groth16.fullProve({
    root: root.toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: extHash.toString(),
    inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
    outputCommitment: [changeCommit.toString(), zeroCommit.toString()],
    inAmount: [nAmt.toString(), '0'],
    inPrivateKey: [priv.toString(), inDummy.priv.toString()],
    inBlinding: [note.blinding, inDummy.blinding.toString()],
    inPathIndices: [leafIndex.toString(), '0'],
    inPathElements: [path.map(x => x.toString()), inDummy.pathElements],
    outAmount: [changeAmt.toString(), '0'],
    outPubkey: [pubKeyOf(cPriv).toString(), pubKeyOf(zPriv).toString()],
    outBlinding: [cBlind.toString(), zBlind.toString()],
  }, '/circuit-tx/Transaction.wasm', '/circuit-tx/Transaction_final.zkey');

  const poolId = getActiveToken().poolId;
  const proofBytes = encodeProof(proof);
  let txHash: string;

  if (useRelayer) {
    // Hand the proof to the relayer — our wallet never signs or appears on-chain.
    onStep?.('Submitting via relayer — your wallet never touches the chain…');
    txHash = await relaySubmit({
      poolId,
      proof: toHex(proofBytes),
      root: toHex(be(root)),
      extAmount: (-wAmt).toString(),
      nullifiers: [toHex(be(null0)), toHex(be(inDummy.nullifier))],
      commitments: [toHex(be(changeCommit)), toHex(be(zeroCommit))],
      recipient,
      fee: fee.toString(),
    });
  } else {
    // Fallback: self-submit through Freighter (visible submitter, still unlinkable
    // to the deposit). relayer = self, fee = 0.
    onStep?.('Relayer offline — submitting from your wallet (visible)…');
    const contract = new Contract(poolId);
    const op = contract.call(
      'transact',
      scvBytes(proofBytes),
      scvBytes(be(root)),
      nativeToScVal(-wAmt, { type: 'i128' }),
      xdr.ScVal.scvVec([scvBytes(be(null0)), scvBytes(be(inDummy.nullifier))]),
      xdr.ScVal.scvVec([scvBytes(be(changeCommit)), scvBytes(be(zeroCommit))]),
      new Address(address).toScVal(),   // account (signer)
      new Address(recipient).toScVal(), // recipient
      new Address(address).toScVal(),   // relayer = self
      nativeToScVal(0n, { type: 'i128' }), // fee
    );
    txHash = await signAndSend(address, op, onStep);
  }
  leafCacheMem = null;

  const notes = getNotes().map(n =>
    n.commitment === note.commitment ? { ...n, spent: true } : n
  );
  let savedChange: UTXONote | null = null;
  if (changeAmt > 0n) {
    savedChange = {
      amount: changeAmt.toString(), privKey: cPriv.toString(), blinding: cBlind.toString(),
      commitment: changeCommit.toString(), leafIndex: leaves.length, spent: false, txHash, ts: Date.now(),
    };
    notes.push(savedChange);
  }
  saveNotes(notes);
  return { txHash, changeNote: savedChange };
}
