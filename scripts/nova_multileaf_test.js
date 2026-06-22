// SUIT — multi-leaf regression test. Mirrors the NEW suit.ts: sync leaves from
// events, deposit into a pool that ALREADY has leaves (note lands at index >=4),
// then withdraw part of it using the full reconstructed tree. This is exactly
// the flow that previously failed with UnknownRoot (#4).
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  rpc, TransactionBuilder, Contract, Address, Keypair, xdr,
  nativeToScVal, scValToNative, Networks, BASE_FEE,
} = require("@stellar/stellar-sdk");

const NETWORK = Networks.TESTNET;
const POOL = "CCCL7IDTJOLVFFXHWHC7INSTDJXQS7N2C2F3UY32JCZZGZ3CQMHXKPM3";
const START = 3230400;
const SECRET = process.env.SUIT_SECRET;
const LEVELS = 16;
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const B = path.join(__dirname, "../circuits/circom/build_tx");
const WASM = path.join(B, "Transaction_js/Transaction.wasm");
const ZKEY = path.join(B, "Transaction_final.zkey");
const VK = JSON.parse(fs.readFileSync(path.join(B, "transaction_vk.json")));

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const kp = Keypair.fromSecret(SECRET);
const SRC = kp.publicKey();

const rnd = () => BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
const pubKey = p => poseidon1([p]);
const commit = (a, pk, b) => poseidon3([a, pk, b]);
const sign = (p, c, i) => poseidon3([p, c, i]);
const nullify = (c, i, s) => poseidon3([c, i, s]);
const be = (v, n = 32) => { let x = ((BigInt(v) % P) + P) % P; const o = Buffer.alloc(n); for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const b2big = b => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };
const g1 = p => Buffer.concat([be(p[0]), be(p[1])]);
const g2 = p => Buffer.concat([be(p[0][1]), be(p[0][0]), be(p[1][1]), be(p[1][0])]);
const scv = b => xdr.ScVal.scvBytes(b);

const ZEROS = [0n]; for (let i = 1; i <= LEVELS; i++) ZEROS.push(poseidon2([ZEROS[i - 1], ZEROS[i - 1]]));
const emptyPath = () => ZEROS.slice(0, LEVELS).map(z => z.toString());
function treeRoot(L) { if (!L.length) return ZEROS[LEVELS]; let a = L.slice(); for (let d = 0; d < LEVELS; d++) { const n = []; const len = Math.max(a.length, 1); for (let i = 0; i < len; i += 2) { n.push(poseidon2([i < a.length ? a[i] : ZEROS[d], i + 1 < a.length ? a[i + 1] : ZEROS[d]])); } a = n; } return a[0]; }
function treePath(idx, L) { const p = []; let a = L.slice(); let k = idx; for (let d = 0; d < LEVELS; d++) { const s = k % 2 === 0 ? k + 1 : k - 1; p.push(s >= 0 && s < a.length ? a[s] : ZEROS[d]); const n = []; const len = Math.max(a.length, 1); for (let i = 0; i < len; i += 2) { n.push(poseidon2([i < a.length ? a[i] : ZEROS[d], i + 1 < a.length ? a[i + 1] : ZEROS[d]])); } a = n; k = Math.floor(k / 2); } return p; }
function dummyInput() { const p = rnd(), b = rnd(); const c = commit(0n, pubKey(p), b); return { priv: p, blinding: b, nullifier: nullify(c, 0n, sign(p, c, 0n)), pathElements: emptyPath() }; }

async function syncLeaves() {
  const idx = new Map();
  const filters = [{ type: "contract", contractIds: [POOL], topics: [["*"]] }];
  let res = await server.getEvents({ startLedger: START, filters, limit: 200 });
  const collect = evs => { for (const e of evs) { try { const d = scValToNative(e.value); if (d && typeof d.leaf_index !== "undefined" && d.out_commitment_0) { idx.set(Number(d.leaf_index), b2big(d.out_commitment_0)); idx.set(Number(d.leaf_index) + 1, b2big(d.out_commitment_1)); } } catch {} } };
  collect(res.events);
  while (res.events.length === 200 && res.cursor) { res = await server.getEvents({ filters, limit: 200, cursor: res.cursor }); collect(res.events); }
  const max = idx.size ? Math.max(...idx.keys()) : -1;
  const L = []; for (let i = 0; i <= max; i++) L.push(idx.get(i) ?? 0n);
  return L;
}
async function prove(input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  if (!(await snarkjs.groth16.verify(VK, publicSignals, proof))) throw new Error("local verify failed");
  return Buffer.concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]);
}
async function view(method) {
  const acct = await server.getAccount(SRC);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NETWORK }).addOperation(new Contract(POOL).call(method)).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  return scValToNative(sim.result.retval);
}
async function send(op, label) {
  const acct = await server.getAccount(SRC);
  const tx = new TransactionBuilder(acct, { fee: (Number(BASE_FEE) * 1000).toString(), networkPassphrase: NETWORK }).addOperation(op).setTimeout(300).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`[${label}] SIM: ${sim.error}`);
  console.log(`[${label}] simulation OK`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`[${label}] SUBMIT: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1500)); const g = await server.getTransaction(sent.hash); if (g.status === rpc.Api.GetTransactionStatus.SUCCESS) { console.log(`[${label}] SUCCESS ${sent.hash}`); return sent.hash; } if (g.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`[${label}] FAILED ${sent.hash}`); }
  throw new Error(`[${label}] timeout`);
}

(async () => {
  console.log("Pool:", POOL);
  let leaves = await syncLeaves();
  console.log("existing leaves:", leaves.length);

  // ---- DEPOSIT 7 XLM into a non-empty pool (lands at index = leaves.length) ----
  const D = 7n * 10000000n;
  const priv = rnd(), blinding = rnd(), pk = pubKey(priv);
  const outCommit = commit(D, pk, blinding);
  const dPriv = rnd(), dBlind = rnd(), dPk = pubKey(dPriv);
  const dummyCommit = commit(0n, dPk, dBlind);
  const inA = dummyInput(), inB = dummyInput();
  const depRoot = b2big(await view("get_root")); // current on-chain root

  console.log("\n=== DEPOSIT 7 XLM (into pool with", leaves.length, "leaves) ===");
  const depProof = await prove({
    root: depRoot.toString(), publicAmount: D.toString(), extDataHash: "0",
    inputNullifier: [inA.nullifier.toString(), inB.nullifier.toString()],
    outputCommitment: [outCommit.toString(), dummyCommit.toString()],
    inAmount: ["0", "0"], inPrivateKey: [inA.priv.toString(), inB.priv.toString()],
    inBlinding: [inA.blinding.toString(), inB.blinding.toString()],
    inPathIndices: ["0", "0"], inPathElements: [inA.pathElements, inB.pathElements],
    outAmount: [D.toString(), "0"], outPubkey: [pk.toString(), dPk.toString()],
    outBlinding: [blinding.toString(), dBlind.toString()],
  });
  const c = new Contract(POOL);
  await send(c.call("transact", scv(depProof), scv(be(depRoot)), nativeToScVal(D, { type: "i128" }), scv(be(0n)),
    xdr.ScVal.scvVec([scv(be(inA.nullifier)), scv(be(inB.nullifier))]),
    xdr.ScVal.scvVec([scv(be(outCommit)), scv(be(dummyCommit))]),
    new Address(SRC).toScVal(), new Address(SRC).toScVal()), "DEPOSIT");

  // ---- WITHDRAW 3 XLM from the new note, change 4, using the FULL tree ----
  leaves = await syncLeaves();
  const myIdx = leaves.findIndex(l => l === outCommit);
  console.log("\nnew note landed at leaf index:", myIdx, "(tree now has", leaves.length, "leaves)");
  if (myIdx < 0) throw new Error("note not found after sync");

  const root = treeRoot(leaves);
  const onchain = b2big(await view("get_root"));
  if (root !== onchain) throw new Error("reconstructed root != on-chain root");
  console.log("reconstructed root == on-chain root ✓");

  const W = 3n * 10000000n, change = D - W;
  const sig0 = sign(priv, outCommit, BigInt(myIdx));
  const null0 = nullify(outCommit, BigInt(myIdx), sig0);
  const inDummy = dummyInput();
  const cPriv = rnd(), cBlind = rnd(), cCommit = commit(change, pubKey(cPriv), cBlind);
  const zPriv = rnd(), zBlind = rnd(), zCommit = commit(0n, pubKey(zPriv), zBlind);
  const recipient = "GBGNO4GRVFFQ6PSE6DCWBFAOBWA7SOFJSVEGT645EVGJQRN4GMS3JG65";

  console.log("\n=== WITHDRAW 3 XLM (change 4) from leaf", myIdx, "===");
  const wProof = await prove({
    root: root.toString(), publicAmount: ((P - W) % P).toString(), extDataHash: "0",
    inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
    outputCommitment: [cCommit.toString(), zCommit.toString()],
    inAmount: [D.toString(), "0"], inPrivateKey: [priv.toString(), inDummy.priv.toString()],
    inBlinding: [blinding.toString(), inDummy.blinding.toString()],
    inPathIndices: [myIdx.toString(), "0"], inPathElements: [treePath(myIdx, leaves).map(x => x.toString()), inDummy.pathElements],
    outAmount: [change.toString(), "0"], outPubkey: [pubKey(cPriv).toString(), pubKey(zPriv).toString()],
    outBlinding: [cBlind.toString(), zBlind.toString()],
  });
  await send(c.call("transact", scv(wProof), scv(be(root)), nativeToScVal(-W, { type: "i128" }), scv(be(0n)),
    xdr.ScVal.scvVec([scv(be(null0)), scv(be(inDummy.nullifier))]),
    xdr.ScVal.scvVec([scv(be(cCommit)), scv(be(zCommit))]),
    new Address(SRC).toScVal(), new Address(recipient).toScVal()), "WITHDRAW");

  console.log("\n=== PASS: multi-leaf deposit + partial withdraw works (the UnknownRoot bug is fixed) ===");
  process.exit(0);
})().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
