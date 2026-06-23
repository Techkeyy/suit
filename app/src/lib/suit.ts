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
  TransactionBuilder,
  Contract,
  Address,
  xdr,
  scValToNative,
  nativeToScVal,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { isConnected, requestAccess, getAddress, signTransaction } from '@stellar/freighter-api';
import { poseidon1, poseidon2, poseidon3 } from 'poseidon-lite';

export const CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  network: Networks.TESTNET,
  poolId: 'CAXFFBZHC7CFYFOQSMV57TAY2CEO6Y2GMOQKLKSERD4O4DBMLFSMDA63',
  verifierId: 'CDEZRSL6WXBEJZ45WVFDI6DIHJEZ6UEWY3CUJIQPLCQIVUMLXXVKON2T',
  tokenId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  startLedger: 3236050, // ~pool deploy ledger (events scanned from here)
  depth: 16,
  decimals: 7,
  explorer: 'https://stellar.expert/explorer/testnet',
};

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
// Namespaced by pool id so a previous pool deployment's cache never poisons a new one.
const LEAFCACHE_KEY = `suit_leafcache_${CONFIG.poolId.slice(0, 8)}`;
let leafCacheMem: bigint[] | null = null;

function loadLeafCache(): Map<number, bigint> {
  const m = new Map<number, bigint>();
  try {
    const raw = JSON.parse(localStorage.getItem(LEAFCACHE_KEY) || '{}');
    for (const k of Object.keys(raw)) m.set(Number(k), BigInt(raw[k]));
  } catch { /* ignore */ }
  return m;
}
function saveLeafCache(m: Map<number, bigint>) {
  const obj: Record<string, string> = {};
  for (const [k, v] of m) obj[k] = v.toString();
  localStorage.setItem(LEAFCACHE_KEY, JSON.stringify(obj));
}

export async function syncLeaves(force = false): Promise<bigint[]> {
  if (leafCacheMem && !force) return leafCacheMem;

  const indexed = loadLeafCache();
  const filters = [{ type: 'contract' as const, contractIds: [CONFIG.poolId], topics: [['*']] }];

  // Clamp start to the RPC's retention window to avoid "startLedger too old" errors;
  // any leaves older than the window are already preserved in the local cache.
  let start = CONFIG.startLedger;
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

const NOTES_KEY = `suit_notes_${CONFIG.poolId.slice(0, 8)}`;

export function getNotes(): UTXONote[] {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch { return []; }
}
function saveNotes(n: UTXONote[]) { localStorage.setItem(NOTES_KEY, JSON.stringify(n)); }

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

// ── tx submission ──
async function signAndSend(address: string, op: xdr.Operation): Promise<string> {
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 1000).toString(),
    networkPassphrase: CONFIG.network,
  }).addOperation(op).setTimeout(300).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation: ${sim.error}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: CONFIG.network, address });
  if ((signed as any).error) throw new Error((signed as any).error);
  const xdrStr = (signed as any).signedTxXdr;
  if (!xdrStr) throw new Error('Wallet returned no signed transaction.');
  const signedTx = TransactionBuilder.fromXDR(xdrStr, CONFIG.network);
  const sent = await server.sendTransaction(signedTx as any);
  if (sent.status === 'ERROR') throw new Error(`Submit: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`Failed on-chain (${sent.hash})`);
  }
  throw new Error('Not confirmed in time');
}

// ── pool queries ──
async function callView(method: string): Promise<any> {
  const addr = await getWalletAddress();
  if (!addr) return null;
  const contract = new Contract(CONFIG.poolId);
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

  onStep?.('Generating zero-knowledge proof… (~30 s)');
  const { proof } = await snarkjs.groth16.fullProve({
    root: root.toString(),
    publicAmount: amt.toString(),
    extDataHash: '0',
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
  const contract = new Contract(CONFIG.poolId);
  const op = contract.call(
    'transact',
    scvBytes(encodeProof(proof)),
    scvBytes(be(root)),
    nativeToScVal(amt, { type: 'i128' }),
    scvBytes(be(0n)),
    xdr.ScVal.scvVec([scvBytes(be(inA.nullifier)), scvBytes(be(inB.nullifier))]),
    xdr.ScVal.scvVec([scvBytes(be(outCommit)), scvBytes(be(dummyCommit))]),
    new Address(address).toScVal(),
    new Address(address).toScVal(),
  );
  const txHash = await signAndSend(address, op);
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

  onStep?.('Generating zero-knowledge proof… (~30 s)');
  const { proof } = await snarkjs.groth16.fullProve({
    root: root.toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: '0',
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

  onStep?.('Submitting withdrawal…');
  const contract = new Contract(CONFIG.poolId);
  const op = contract.call(
    'transact',
    scvBytes(encodeProof(proof)),
    scvBytes(be(root)),
    nativeToScVal(-wAmt, { type: 'i128' }),
    scvBytes(be(0n)),
    xdr.ScVal.scvVec([scvBytes(be(null0)), scvBytes(be(inDummy.nullifier))]),
    xdr.ScVal.scvVec([scvBytes(be(changeCommit)), scvBytes(be(zeroCommit))]),
    new Address(address).toScVal(),
    new Address(recipient).toScVal(),
  );
  const txHash = await signAndSend(address, op);
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
