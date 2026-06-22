// SUIT — browser client for the Nova arbitrary-amount UTXO pool (v3).
//
// Deposit any amount. Withdraw any portion. Change returned as a new note.
// All proven in zero-knowledge (Groth16 BN254) — the chain sees only roots,
// nullifiers, and commitments; never which deposit funds which withdrawal.

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
  poolId: 'CDCSJMPOU6J6ZRSPFTYTGQELOXQCFG7VHX67RO4O5YDAKLTGFVNSYBXY',
  verifierId: 'CDEZRSL6WXBEJZ45WVFDI6DIHJEZ6UEWY3CUJIQPLCQIVUMLXXVKON2T',
  tokenId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
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

// ── UTXO note store ──
export interface UTXONote {
  amount: string;
  privKey: string;
  blinding: string;
  commitment: string;
  leafIndex: number;
  spent: boolean;
  txHash: string;
  ts: number;
}

const NOTES_KEY = 'suit_v3_notes';
const LEAVES_KEY = 'suit_v3_leaves';

export function getNotes(): UTXONote[] {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch { return []; }
}
function saveNotes(n: UTXONote[]) { localStorage.setItem(NOTES_KEY, JSON.stringify(n)); }
function getLeaves(): string[] {
  try { return JSON.parse(localStorage.getItem(LEAVES_KEY) || '[]'); } catch { return []; }
}
function saveLeaves(l: string[]) { localStorage.setItem(LEAVES_KEY, JSON.stringify(l)); }
function pushLeaves(commitments: bigint[]): number {
  const leaves = getLeaves();
  const start = leaves.length;
  for (const c of commitments) leaves.push(c.toString());
  saveLeaves(leaves);
  return start;
}
function allLeaves(): bigint[] { return getLeaves().map(s => BigInt(s)); }
function localRoot(): bigint {
  const l = allLeaves();
  return l.length > 0 ? treeRoot(l) : ZEROS[CONFIG.depth];
}

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
  const signedTx = TransactionBuilder.fromXDR((signed as any).signedTxXdr, CONFIG.network);
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
export async function getPoolCount(): Promise<number> {
  try {
    const addr = await getWalletAddress();
    if (!addr) return 0;
    const contract = new Contract(CONFIG.poolId);
    const account = await server.getAccount(addr);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: CONFIG.network })
      .addOperation(contract.call('get_count')).setTimeout(30).build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result) return 0;
    return Number(scValToNative(sim.result.retval));
  } catch { return 0; }
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
  onStep?.('Generating secret note…');

  const priv = randomField(), blinding = randomField();
  const pk = pubKeyOf(priv);
  const outCommit = commitHash(amt, pk, blinding);

  const dPriv = randomField(), dBlind = randomField();
  const dPk = pubKeyOf(dPriv);
  const dummyCommit = commitHash(0n, dPk, dBlind);

  const inA = dummyInput(), inB = dummyInput();
  const root = localRoot();

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
    nativeToScVal(Number(amt), { type: 'i128' }),
    scvBytes(be(0n)),
    xdr.ScVal.scvVec([scvBytes(be(inA.nullifier)), scvBytes(be(inB.nullifier))]),
    xdr.ScVal.scvVec([scvBytes(be(outCommit)), scvBytes(be(dummyCommit))]),
    new Address(address).toScVal(),
    new Address(address).toScVal(),
  );
  const txHash = await signAndSend(address, op);

  const leafIdx = pushLeaves([outCommit, dummyCommit]);
  const note: UTXONote = {
    amount: amt.toString(), privKey: priv.toString(), blinding: blinding.toString(),
    commitment: outCommit.toString(), leafIndex: leafIdx, spent: false, txHash, ts: Date.now(),
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
  onStep?.('Building Merkle proof…');

  const leaves = allLeaves();
  const root = treeRoot(leaves);
  const path = treePath(note.leafIndex, leaves);

  const priv = BigInt(note.privKey);
  const commitment = BigInt(note.commitment);
  const sig = signHash(priv, commitment, BigInt(note.leafIndex));
  const null0 = nullHash(commitment, BigInt(note.leafIndex), sig);
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
    inPathIndices: [note.leafIndex.toString(), '0'],
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
    nativeToScVal(-Number(wAmt), { type: 'i128' }),
    scvBytes(be(0n)),
    xdr.ScVal.scvVec([scvBytes(be(null0)), scvBytes(be(inDummy.nullifier))]),
    xdr.ScVal.scvVec([scvBytes(be(changeCommit)), scvBytes(be(zeroCommit))]),
    new Address(address).toScVal(),
    new Address(recipient).toScVal(),
  );
  const txHash = await signAndSend(address, op);

  const leafIdx = pushLeaves([changeCommit, zeroCommit]);
  const notes = getNotes().map(n =>
    n.leafIndex === note.leafIndex ? { ...n, spent: true } : n
  );
  let savedChange: UTXONote | null = null;
  if (changeAmt > 0n) {
    savedChange = {
      amount: changeAmt.toString(), privKey: cPriv.toString(), blinding: cBlind.toString(),
      commitment: changeCommit.toString(), leafIndex: leafIdx, spent: false, txHash, ts: Date.now(),
    };
    notes.push(savedChange);
  }
  saveNotes(notes);
  return { txHash, changeNote: savedChange };
}
