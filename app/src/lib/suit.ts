// SUIT — browser client for the UNLINKABLE pool (v2).
//
// Deposit posts a commitment = Poseidon(nullifier, secret) and escrows a fixed
// denomination. Withdraw builds a Merkle path locally, generates a Groth16
// proof IN THE BROWSER (snarkjs + the Withdraw circuit), and submits it — the
// pool verifies it on-chain and pays out, revealing only (root, nullifierHash,
// recipient). No link between deposit and withdrawal.

import {
  rpc,
  TransactionBuilder,
  Contract,
  Address,
  StrKey,
  xdr,
  scValToNative,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { isConnected, requestAccess, getAddress, signTransaction } from '@stellar/freighter-api';
import { poseidon1, poseidon2 } from 'poseidon-lite';

export const CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  network: Networks.TESTNET,
  poolId: 'CCTFFZ7IYXTVM66OBAUMKHVU2RCDY26NHULIHBWHOIY2UJVNPXJ5LSJC',
  verifierId: 'CAQWWQ4P7RYGBDRIUQQ7FUXC3SXAHI52YCCQUVCXMNVACNBN52LHMOP7',
  tokenId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  denomination: 100, // XLM (fixed — uniformity is what makes deposits unlinkable)
  depth: 16,
  explorer: 'https://stellar.expert/explorer/testnet',
};

// BN254 scalar field
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const server = new rpc.Server(CONFIG.rpcUrl);

// ── field / byte helpers ──
function randomField(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v % R;
}
function be(v: bigint, n = 32): Uint8Array {
  let x = ((v % R) + R) % R;
  const o = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o;
}
function beAny(v: bigint, n = 32): Uint8Array {
  let x = v;
  const o = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o;
}
function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function concat(a: Uint8Array[]): Uint8Array {
  const len = a.reduce((s, x) => s + x.length, 0);
  const o = new Uint8Array(len);
  let p = 0;
  for (const x of a) { o.set(x, p); p += x.length; }
  return o;
}
const scvBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b));

// ── Merkle tree (poseidon-lite, matches the on-chain tree) ──
function zeros(): bigint[] {
  const z = [0n];
  for (let i = 1; i <= CONFIG.depth; i++) z.push(poseidon2([z[i - 1], z[i - 1]]));
  return z;
}
function buildPath(index: number, leaves: bigint[]) {
  const z = zeros();
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let layer = leaves.slice();
  let idx = index;
  for (let d = 0; d < CONFIG.depth; d++) {
    const isRight = idx % 2 === 1;
    const sib = isRight ? layer[idx - 1] : layer[idx + 1];
    pathElements.push(sib === undefined ? z[d] : sib);
    pathIndices.push(isRight ? 1 : 0);
    const next: bigint[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const l = layer[i];
      const r = i + 1 < layer.length ? layer[i + 1] : z[d];
      next.push(poseidon2([l, r]));
    }
    layer = next.length ? next : [z[d + 1]];
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

// ── note store (this device is the source of truth for leaves) ──
export interface Note {
  nullifier: string;
  secret: string;
  commitment: string; // decimal
  leafIndex: number;
  spent: boolean;
  txHash: string;
  ts: number;
}
const NOTES_KEY = 'suit_v2_notes';
export function getNotes(): Note[] {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch { return []; }
}
function saveNotes(n: Note[]) { localStorage.setItem(NOTES_KEY, JSON.stringify(n)); }
function allLeaves(): bigint[] {
  return getNotes().sort((a, b) => a.leafIndex - b.leafIndex).map((n) => BigInt(n.commitment));
}

// ── wallet ──
export async function connectWallet(): Promise<string> {
  const c = await isConnected();
  if (!(c as any).isConnected) throw new Error('Freighter not detected. Install the Freighter extension.');
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

// ── tx ──
async function signAndSend(address: string, op: xdr.Operation): Promise<string> {
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 1000).toString(),
    networkPassphrase: CONFIG.network,
  }).addOperation(op).setTimeout(120).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();

  const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: CONFIG.network, address });
  if ((signed as any).error) throw new Error((signed as any).error);
  const signedTx = TransactionBuilder.fromXDR((signed as any).signedTxXdr, CONFIG.network);
  const sent = await server.sendTransaction(signedTx as any);
  if (sent.status === 'ERROR') throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`On-chain failure (tx ${sent.hash})`);
  }
  throw new Error('Transaction not confirmed in time');
}

// ── actions ──
export interface ShieldResult { txHash: string; note: Note; }

/** Shield the fixed denomination: post a commitment (no proof at deposit). */
export async function shield(address: string): Promise<ShieldResult> {
  const nullifier = randomField();
  const secret = randomField();
  const commitment = poseidon2([nullifier, secret]);
  const leafIndex = getNotes().length;

  const contract = new Contract(CONFIG.poolId);
  const op = contract.call('deposit', new Address(address).toScVal(), scvBytes(be(commitment)));
  const txHash = await signAndSend(address, op);

  const note: Note = {
    nullifier: nullifier.toString(), secret: secret.toString(),
    commitment: commitment.toString(), leafIndex, spent: false, txHash, ts: Date.now(),
  };
  saveNotes([...getNotes(), note]);
  return { txHash, note };
}

/** Withdraw a note to any address — generates the unlinkable ZK proof in-browser. */
export async function withdraw(
  address: string,
  note: Note,
  recipient: string,
  onStep?: (m: string) => void
): Promise<string> {
  const snarkjs = await import('snarkjs');
  const nullifier = BigInt(note.nullifier);
  const secret = BigInt(note.secret);
  const nullifierHash = poseidon1([nullifier]);

  // recipient address → field element (bound into the proof)
  const raw = StrKey.decodeEd25519PublicKey(recipient);
  const recipientField = BigInt('0x' + Buffer.from(raw).toString('hex')) % R;

  onStep?.('Rebuilding Merkle path…');
  const leaves = allLeaves();
  const { pathElements, pathIndices } = buildPath(note.leafIndex, leaves);
  // recompute root
  let cur = BigInt(note.commitment);
  for (let i = 0; i < CONFIG.depth; i++) {
    cur = pathIndices[i] === 1 ? poseidon2([pathElements[i], cur]) : poseidon2([cur, pathElements[i]]);
  }
  const root = cur;

  onStep?.('Generating zero-knowledge proof in your browser…');
  const input = {
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipientField.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
  };
  const { proof } = await snarkjs.groth16.fullProve(
    input,
    '/circuit-withdraw/Withdraw.wasm',
    '/circuit-withdraw/Withdraw_final.zkey'
  );

  // encode proof → BN254 soroban bytes (BE-32, Fq2 = c1||c0)
  const g1 = (p: string[]) => concat([beAny(BigInt(p[0])), beAny(BigInt(p[1]))]);
  const g2 = (p: string[][]) =>
    concat([beAny(BigInt(p[0][1])), beAny(BigInt(p[0][0])), beAny(BigInt(p[1][1])), beAny(BigInt(p[1][0]))]);
  const proofBytes = concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]);

  onStep?.('Submitting withdrawal…');
  const contract = new Contract(CONFIG.poolId);
  const op = contract.call(
    'withdraw',
    new Address(recipient).toScVal(),
    scvBytes(be(recipientField)),
    scvBytes(beAny(nullifierHash)),
    scvBytes(beAny(root)),
    scvBytes(proofBytes)
  );
  const txHash = await signAndSend(address, op);

  const notes = getNotes().map((n) => (n.leafIndex === note.leafIndex ? { ...n, spent: true } : n));
  saveNotes(notes);
  return txHash;
}

export async function getPoolCount(): Promise<number> {
  try {
    const contract = new Contract(CONFIG.poolId);
    const src = await server.getAccount((await getWalletAddress()) || '');
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: CONFIG.network })
      .addOperation(contract.call('get_count')).setTimeout(30).build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result) return getNotes().length;
    return Number(scValToNative(sim.result.retval));
  } catch { return getNotes().length; }
}
