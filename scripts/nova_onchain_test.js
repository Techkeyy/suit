// SUIT — REAL on-chain deposit + partial withdraw to pool v3, signed with a
// keypair (not Freighter). Mirrors app/src/lib/suit.ts exactly to isolate
// whether the withdraw failure is in the contract/tx or in the wallet flow.
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  rpc, TransactionBuilder, Contract, Address, Keypair, xdr,
  nativeToScVal, Networks, BASE_FEE,
} = require("@stellar/stellar-sdk");

const RPC = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const POOL = process.env.SUIT_POOL || "CCCL7IDTJOLVFFXHWHC7INSTDJXQS7N2C2F3UY32JCZZGZ3CQMHXKPM3";
const SECRET = process.env.SUIT_SECRET; // deployer secret
const LEVELS = 16;
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const B = path.join(__dirname, "../circuits/circom/build_tx");
const WASM = path.join(B, "Transaction_js/Transaction.wasm");
const ZKEY = path.join(B, "Transaction_final.zkey");
const VK = JSON.parse(fs.readFileSync(path.join(B, "transaction_vk.json")));

const server = new rpc.Server(RPC);
const kp = Keypair.fromSecret(SECRET);
const SRC = kp.publicKey();

const rnd = () => BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
const pubKey = (priv) => poseidon1([priv]);
const commit = (a, pk, b) => poseidon3([a, pk, b]);
const sign = (priv, c, idx) => poseidon3([priv, c, idx]);
const nullify = (c, idx, sig) => poseidon3([c, idx, sig]);
const be = (v, n = 32) => { let x = ((BigInt(v) % P) + P) % P; const o = Buffer.alloc(n); for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const g1 = p => Buffer.concat([be(p[0]), be(p[1])]);
const g2 = p => Buffer.concat([be(p[0][1]), be(p[0][0]), be(p[1][1]), be(p[1][0])]);
const scvBytes = b => xdr.ScVal.scvBytes(b);

const ZEROS = [0n];
for (let i = 1; i <= LEVELS; i++) ZEROS.push(poseidon2([ZEROS[i - 1], ZEROS[i - 1]]));
function emptyPath() { return ZEROS.slice(0, LEVELS).map(z => z.toString()); }
function treeRoot(leaves) {
  let layer = leaves.slice();
  for (let d = 0; d < LEVELS; d++) {
    const next = []; const len = Math.max(layer.length, 1);
    for (let i = 0; i < len; i += 2) {
      const l = i < layer.length ? layer[i] : ZEROS[d];
      const r = i + 1 < layer.length ? layer[i + 1] : ZEROS[d];
      next.push(poseidon2([l, r]));
    }
    layer = next;
  }
  return layer[0];
}
function treePath(index, leaves) {
  const path = []; let layer = leaves.slice(); let idx = index;
  for (let d = 0; d < LEVELS; d++) {
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    path.push(sib >= 0 && sib < layer.length ? layer[sib] : ZEROS[d]);
    const next = []; const len = Math.max(layer.length, 1);
    for (let i = 0; i < len; i += 2) {
      const l = i < layer.length ? layer[i] : ZEROS[d];
      const r = i + 1 < layer.length ? layer[i + 1] : ZEROS[d];
      next.push(poseidon2([l, r]));
    }
    layer = next; idx = Math.floor(idx / 2);
  }
  return path;
}
function dummyInput() {
  const priv = rnd(), blinding = rnd();
  const c = commit(0n, pubKey(priv), blinding);
  const sig = sign(priv, c, 0n);
  return { priv, blinding, nullifier: nullify(c, 0n, sig), pathElements: emptyPath() };
}
async function prove(input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  if (!(await snarkjs.groth16.verify(VK, publicSignals, proof))) throw new Error("local verify failed");
  return Buffer.concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]);
}

async function signAndSend(op, label) {
  const account = await server.getAccount(SRC);
  const tx = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 1000).toString(), networkPassphrase: NETWORK })
    .addOperation(op).setTimeout(300).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`[${label}] SIM ERROR: ${sim.error}`);
  console.log(`[${label}] simulation OK`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`[${label}] SUBMIT ERROR: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) { console.log(`[${label}] SUCCESS tx=${sent.hash}`); return sent.hash; }
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`[${label}] ON-CHAIN FAILED tx=${sent.hash} ${JSON.stringify(got.resultXdr)}`);
  }
  throw new Error(`[${label}] not confirmed`);
}

(async () => {
  console.log("Source:", SRC, "Pool:", POOL);

  // ---- DEPOSIT 5 XLM ----
  const D = 5n * 10000000n; // stroops
  const priv = rnd(), blinding = rnd(), pk = pubKey(priv);
  const outCommit = commit(D, pk, blinding);
  const dPriv = rnd(), dBlind = rnd(), dPk = pubKey(dPriv);
  const dummyCommit = commit(0n, dPk, dBlind);
  const inA = dummyInput(), inB = dummyInput();
  const depRoot = ZEROS[LEVELS]; // empty tree

  console.log("\n=== DEPOSIT 5 XLM ===");
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
  await signAndSend(c.call("transact",
    scvBytes(depProof), scvBytes(be(depRoot)), nativeToScVal(Number(D), { type: "i128" }), scvBytes(be(0n)),
    xdr.ScVal.scvVec([scvBytes(be(inA.nullifier)), scvBytes(be(inB.nullifier))]),
    xdr.ScVal.scvVec([scvBytes(be(outCommit)), scvBytes(be(dummyCommit))]),
    new Address(SRC).toScVal(), new Address(SRC).toScVal(),
  ), "DEPOSIT");

  // ---- WITHDRAW 2 XLM (change 3) ----
  const leaves = [outCommit, dummyCommit];
  const root = treeRoot(leaves);
  const W = 2n * 10000000n;
  const change = D - W;
  const sig0 = sign(priv, outCommit, 0n);
  const null0 = nullify(outCommit, 0n, sig0);
  const inDummy = dummyInput();
  const cPriv = rnd(), cBlind = rnd(), cCommit = commit(change, pubKey(cPriv), cBlind);
  const zPriv = rnd(), zBlind = rnd(), zCommit = commit(0n, pubKey(zPriv), zBlind);
  const publicAmount = (P - W) % P;
  const recipient = "GBGNO4GRVFFQ6PSE6DCWBFAOBWA7SOFJSVEGT645EVGJQRN4GMS3JG65";

  console.log("\n=== WITHDRAW 2 XLM (change 3) ===");
  const wProof = await prove({
    root: root.toString(), publicAmount: publicAmount.toString(), extDataHash: "0",
    inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
    outputCommitment: [cCommit.toString(), zCommit.toString()],
    inAmount: [D.toString(), "0"], inPrivateKey: [priv.toString(), inDummy.priv.toString()],
    inBlinding: [blinding.toString(), inDummy.blinding.toString()],
    inPathIndices: ["0", "0"], inPathElements: [treePath(0, leaves).map(x => x.toString()), inDummy.pathElements],
    outAmount: [change.toString(), "0"], outPubkey: [pubKey(cPriv).toString(), pubKey(zPriv).toString()],
    outBlinding: [cBlind.toString(), zBlind.toString()],
  });
  await signAndSend(c.call("transact",
    scvBytes(wProof), scvBytes(be(root)), nativeToScVal(-Number(W), { type: "i128" }), scvBytes(be(0n)),
    xdr.ScVal.scvVec([scvBytes(be(null0)), scvBytes(be(inDummy.nullifier))]),
    xdr.ScVal.scvVec([scvBytes(be(cCommit)), scvBytes(be(zCommit))]),
    new Address(SRC).toScVal(), new Address(recipient).toScVal(),
  ), "WITHDRAW");

  console.log("\n=== ALL GOOD: on-chain deposit + partial withdraw succeeded ===");
  process.exit(0);
})().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
