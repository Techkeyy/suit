// SUIT — browser client for the live testnet contracts.
//
// Everything runs client-side: Groth16 proving (snarkjs), the snarkjs→Soroban
// byte encoding (verified byte-for-byte against the Rust converter), the
// keccak256 Merkle path, and Freighter signing. No backend, no secrets.

import {
  rpc,
  TransactionBuilder,
  Contract,
  Address,
  xdr,
  nativeToScVal,
  scValToNative,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import {
  isConnected,
  requestAccess,
  getAddress,
  signTransaction,
} from '@stellar/freighter-api';
import { keccak256 } from 'js-sha3';

// ---- deployed testnet config ----
export const CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  network: Networks.TESTNET,
  poolId: 'CBTU3EAAQPYBSM7LCYMP2Q6AVBXSVGZWDBJNWBCER35YCKDF5J2HWET6',
  verifierId: 'CA2W26LBXZ7FZWKKPW4NHTO52AUYWBAT47S2QMMDDEWORFG4RYQKAWIV',
  tokenId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  denomination: 1_000_000_000n, // 100 XLM (7 decimals)
  depth: 16,
  // policy bounds proven by the range circuit (denomination sits inside)
  minAmount: 100_000_000n, // 10 XLM
  maxAmount: 100_000_000_000n, // 10,000 XLM
  explorer: 'https://stellar.expert/explorer/testnet',
};

const server = new rpc.Server(CONFIG.rpcUrl);

// ───────────────────────── byte encoding (verified) ─────────────────────────
// G1/G2 coordinates: big-endian 48 bytes. Fq2 serialized as c1 ‖ c0.
// Public signals: u32 BE count, each signal 32-byte big-endian.

function be(value: bigint | string, n: number): Uint8Array {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  const out = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
const g1 = (p: string[]) => concat([be(p[0], 48), be(p[1], 48)]);
const g2 = (p: string[][]) =>
  concat([be(p[0][1], 48), be(p[0][0], 48), be(p[1][1], 48), be(p[1][0], 48)]);

export function encodeProof(proof: any): Uint8Array {
  return concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]);
}
export function encodePublic(signals: string[]): Uint8Array {
  return concat([u32be(signals.length), ...signals.map((s) => be(s, 32))]);
}

// ───────────────────────── proving (snarkjs in browser) ─────────────────────

export interface ProofBundle {
  proofBytes: Uint8Array;
  publicBytes: Uint8Array;
  commitment: bigint;
  publicSignals: string[];
}

export async function generateRangeProof(amount: bigint, secret: bigint): Promise<ProofBundle> {
  const snarkjs = await import('snarkjs');
  const commitment = amount + secret;
  const input = {
    amount: amount.toString(),
    secret: secret.toString(),
    min_amount: CONFIG.minAmount.toString(),
    max_amount: CONFIG.maxAmount.toString(),
    commitment: commitment.toString(),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    '/circuit/RangeProof.wasm',
    '/circuit/RangeProof_final.zkey'
  );
  return {
    proofBytes: encodeProof(proof),
    publicBytes: encodePublic(publicSignals),
    commitment,
    publicSignals,
  };
}

// ───────────────────────── keccak Merkle (matches contract) ─────────────────

const SEED = new TextEncoder().encode('SUIT_ZERO_LEAF_V1______________');
const kc = (buf: Uint8Array): Uint8Array => new Uint8Array(keccak256.arrayBuffer(buf));
const pair = (a: Uint8Array, b: Uint8Array) => kc(concat([a, b]));

function zeros(): Uint8Array[] {
  const z = [kc(SEED)];
  for (let i = 1; i < CONFIG.depth; i++) z.push(pair(z[i - 1], z[i - 1]));
  return z;
}

export function buildPath(index: number, leaves: Uint8Array[]) {
  const z = zeros();
  const pathElements: Uint8Array[] = [];
  const pathIndices: number[] = [];
  let layer = leaves.slice();
  let idx = index;
  for (let level = 0; level < CONFIG.depth; level++) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : z[level];
    pathElements.push(sibling);
    pathIndices.push(isRight ? 1 : 0);
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const l = layer[i];
      const r = i + 1 < layer.length ? layer[i + 1] : z[level];
      next.push(pair(l, r));
    }
    layer = next.length ? next : [z[level + 1]];
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

export function computeRoot(leaf: Uint8Array, pe: Uint8Array[], pi: number[]): Uint8Array {
  let node = leaf;
  for (let i = 0; i < CONFIG.depth; i++) {
    node = pi[i] === 1 ? pair(pe[i], node) : pair(node, pe[i]);
  }
  return node;
}

// ───────────────────────── note + leaf derivation ───────────────────────────

export interface Note {
  amount: string; // decimal string
  secret: string; // decimal string
  leafHex: string;
  nullifierHex: string;
  leafIndex?: number;
}

export function deriveNote(amount: bigint, secret: bigint): Omit<Note, 'leafIndex'> {
  const commitment = amount + secret;
  const leaf = be(commitment, 32);
  const nullifier = kc(be(secret, 32));
  return {
    amount: amount.toString(),
    secret: secret.toString(),
    leafHex: toHex(leaf),
    nullifierHex: toHex(nullifier),
  };
}

export function randomSecret(): bigint {
  const bytes = new Uint8Array(30);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

// ───────────────────────── leaves store (localStorage) ──────────────────────
// The app is the source of truth for the leaf set (fresh pool, app is the sole
// depositor). Each successful deposit appends its leaf in index order.

const LEAVES_KEY = 'suit_leaves_v1';
const NOTES_KEY = 'suit_notes_v1';

export function getStoredLeaves(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LEAVES_KEY) || '[]');
  } catch {
    return [];
  }
}
function appendLeaf(leafHex: string): number {
  const leaves = getStoredLeaves();
  const index = leaves.length;
  leaves.push(leafHex);
  localStorage.setItem(LEAVES_KEY, JSON.stringify(leaves));
  return index;
}

export interface StoredNote extends Note {
  spent: boolean;
  txHash: string;
  ts: number;
}

export function getNotes(): StoredNote[] {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
  } catch {
    return [];
  }
}
function addNote(note: StoredNote) {
  const notes = getNotes();
  notes.push(note);
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}
function markNoteSpent(leafHex: string) {
  const notes = getNotes().map((n) => (n.leafHex === leafHex ? { ...n, spent: true } : n));
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

// ───────────────────────── Freighter wallet ─────────────────────────────────

export async function connectWallet(): Promise<string> {
  const c = await isConnected();
  if (!(c as any).isConnected) {
    throw new Error('Freighter not detected. Install the Freighter extension.');
  }
  const access = await requestAccess();
  if ((access as any).error) throw new Error((access as any).error);
  return (access as any).address as string;
}

export async function getWalletAddress(): Promise<string | null> {
  try {
    const c = await isConnected();
    if (!(c as any).isConnected) return null;
    const a = await getAddress();
    return (a as any).address || null;
  } catch {
    return null;
  }
}

// ───────────────────────── tx helpers ───────────────────────────────────────

const scvBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b));
const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function signAndSend(address: string, op: xdr.Operation): Promise<string> {
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 100).toString(),
    networkPassphrase: CONFIG.network,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();

  const signed = await signTransaction(prepared.toXDR(), {
    networkPassphrase: CONFIG.network,
    address,
  });
  if ((signed as any).error) throw new Error((signed as any).error);

  const signedTx = TransactionBuilder.fromXDR((signed as any).signedTxXdr, CONFIG.network);
  const sent = await server.sendTransaction(signedTx as any);
  if (sent.status === 'ERROR') {
    throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain (hash ${sent.hash})`);
    }
  }
  throw new Error('Transaction not confirmed in time');
}

// ───────────────────────── public actions ───────────────────────────────────

/** Read-only on-chain Groth16 verification (no signing). */
export async function verifyOnChain(proofBytes: Uint8Array, publicBytes: Uint8Array): Promise<boolean> {
  const contract = new Contract(CONFIG.verifierId);
  // Build a throwaway-source tx purely for simulation of a read-only call.
  const src = await server.getAccount(
    (await getWalletAddress()) || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
  ).catch(() => null as any);
  if (!src) throw new Error('Connect a wallet to run on-chain verify');
  const tx = new TransactionBuilder(src, {
    fee: BASE_FEE,
    networkPassphrase: CONFIG.network,
  })
    .addOperation(contract.call('verify', scvBytes(proofBytes), scvBytes(publicBytes)))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result) throw new Error('verify simulation failed');
  return scValToNative(sim.result.retval) as boolean;
}

export interface DepositResult {
  txHash: string;
  note: Note;
}

/** Shield `amount` (base units): generate a proof, then deposit (ZK-gated). */
export async function deposit(address: string, amount: bigint): Promise<DepositResult> {
  const secret = randomSecret();
  const note = deriveNote(amount, secret);
  const bundle = await generateRangeProof(amount, secret);

  const contract = new Contract(CONFIG.poolId);
  const op = contract.call(
    'deposit',
    new Address(address).toScVal(),
    scvBytes(hexToBytes(note.leafHex)),
    nativeToScVal(amount, { type: 'i128' }),
    scvBytes(bundle.proofBytes),
    scvBytes(bundle.publicBytes)
  );
  const txHash = await signAndSend(address, op);
  const leafIndex = appendLeaf(note.leafHex);
  addNote({ ...note, leafIndex, spent: false, txHash, ts: Date.now() });
  return { txHash, note: { ...note, leafIndex } };
}

/** Withdraw a note to a recipient using a Merkle path + nullifier. */
export async function withdraw(
  address: string,
  note: { amount: string; secret: string },
  recipient: string
): Promise<string> {
  const derived = deriveNote(BigInt(note.amount), BigInt(note.secret));
  const leaves = getStoredLeaves().map((h) => hexToBytes(h));
  const leafIndex = getStoredLeaves().indexOf(derived.leafHex);
  if (leafIndex < 0) throw new Error('Note not found in local leaf set (deposit on this device first)');

  const leaf = hexToBytes(derived.leafHex);
  const { pathElements, pathIndices } = buildPath(leafIndex, leaves);
  const root = computeRoot(leaf, pathElements, pathIndices);

  const contract = new Contract(CONFIG.poolId);
  const op = contract.call(
    'withdraw',
    new Address(recipient).toScVal(),
    scvBytes(hexToBytes(derived.nullifierHex)),
    scvBytes(leaf),
    xdr.ScVal.scvVec(pathElements.map((e) => scvBytes(e))),
    xdr.ScVal.scvVec(pathIndices.map((i) => nativeToScVal(i, { type: 'u32' }))),
    scvBytes(root)
  );
  const txHash = await signAndSend(address, op);
  markNoteSpent(derived.leafHex);
  return txHash;
}

export async function getPoolCount(): Promise<number> {
  const contract = new Contract(CONFIG.poolId);
  const src = await server.getAccount(
    (await getWalletAddress()) || ''
  ).catch(() => null as any);
  if (!src) return getStoredLeaves().length;
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: CONFIG.network })
    .addOperation(contract.call('get_count'))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result) return getStoredLeaves().length;
  return Number(scValToNative(sim.result.retval));
}

export { toHex };
