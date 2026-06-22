// SUIT — Nova end-to-end: deposit arbitrary amount → withdraw partial (with change) on testnet.
// Outputs stellar CLI commands to run the on-chain transactions.
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LEVELS = 16;
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const B = path.join(__dirname, "../circuits/circom/build_tx");
const WASM = path.join(B, "Transaction_js/Transaction.wasm");
const ZKEY = path.join(B, "Transaction_final.zkey");

const rnd = () => BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
const pubKey = (priv) => poseidon1([priv]);
const commit = (amount, pk, blinding) => poseidon3([amount, pk, blinding]);
const sign = (priv, c, idx) => poseidon3([priv, c, idx]);
const nullify = (c, idx, sig) => poseidon3([c, idx, sig]);
const beHex = (v, n = 32) => { let x = BigInt(v); const o = Buffer.alloc(n); for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o.toString("hex"); };
const g1 = p => Buffer.concat([Buffer.from(beHex(p[0], 32), "hex"), Buffer.from(beHex(p[1], 32), "hex")]);
const g2 = p => Buffer.concat([Buffer.from(beHex(p[0][1], 32), "hex"), Buffer.from(beHex(p[0][0], 32), "hex"), Buffer.from(beHex(p[1][1], 32), "hex"), Buffer.from(beHex(p[1][0], 32), "hex")]);

const ZEROS = [0n];
for (let i = 1; i <= LEVELS; i++) ZEROS.push(poseidon2([ZEROS[i - 1], ZEROS[i - 1]]));
function emptyPath() { return ZEROS.slice(0, LEVELS).map(z => z.toString()); }

function dummyInput() {
  const priv = rnd(), blinding = rnd(), amount = 0n, idx = 0n;
  const c = commit(amount, pubKey(priv), blinding);
  const sig = sign(priv, c, idx);
  return { amount, priv, blinding, idx, pathElements: emptyPath(), nullifier: nullify(c, idx, sig) };
}
function makeNote(amount) { return { amount, priv: rnd(), blinding: rnd() }; }
function noteCommit(n) { return commit(n.amount, pubKey(n.priv), n.blinding); }

async function prove(input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const vk = JSON.parse(fs.readFileSync(path.join(B, "transaction_vk.json")));
  const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
  if (!ok) throw new Error("local verify failed");
  const proofHex = Buffer.concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]).toString("hex");
  return { proofHex, publicSignals };
}

(async () => {
  // ---- DEPOSIT 137 XLM (1_370_000_000 stroops) ----
  const D = 137n;
  const depNote = makeNote(D);
  const outDummy = makeNote(0n);
  const inA = dummyInput(), inB = dummyInput();
  const extDataHash = 12345n;

  console.log("=== GENERATING DEPOSIT PROOF (137 XLM) ===");
  const dep = await prove({
    root: "0",
    publicAmount: D.toString(),
    extDataHash: extDataHash.toString(),
    inputNullifier: [inA.nullifier.toString(), inB.nullifier.toString()],
    outputCommitment: [noteCommit(depNote).toString(), noteCommit(outDummy).toString()],
    inAmount: ["0", "0"],
    inPrivateKey: [inA.priv.toString(), inB.priv.toString()],
    inBlinding: [inA.blinding.toString(), inB.blinding.toString()],
    inPathIndices: ["0", "0"],
    inPathElements: [inA.pathElements, inB.pathElements],
    outAmount: [D.toString(), "0"],
    outPubkey: [pubKey(depNote.priv).toString(), pubKey(outDummy.priv).toString()],
    outBlinding: [depNote.blinding.toString(), outDummy.blinding.toString()],
  });

  // The contract expects ext_amount in stroops (7 decimals)
  const depStroops = Number(D) * 10000000;

  console.log("DEPOSIT_PROOF=" + dep.proofHex);
  console.log("DEPOSIT_ROOT=" + beHex(0n));
  console.log("DEPOSIT_EXT_AMOUNT=" + depStroops);
  console.log("DEPOSIT_EXT_DATA_HASH=" + beHex(extDataHash));
  console.log("DEPOSIT_NULL0=" + beHex(inA.nullifier));
  console.log("DEPOSIT_NULL1=" + beHex(inB.nullifier));
  console.log("DEPOSIT_OUT0=" + beHex(noteCommit(depNote)));
  console.log("DEPOSIT_OUT1=" + beHex(noteCommit(outDummy)));

  // ---- WITHDRAW 50 XLM (change = 87) ----
  const W = 50n;
  const change = makeNote(D - W);
  const outZero = makeNote(0n);
  const leaf = noteCommit(depNote);
  const leafDummy = noteCommit(outDummy);

  // build tree: leaf at 0, leafDummy at 1
  let cur0 = leaf, cur1 = leafDummy;
  // level 0: hash(leaf, leafDummy)
  let lvl = poseidon2([leaf, leafDummy]);
  // levels 1..15: hash(lvl, zeros[i])
  let root = lvl;
  for (let i = 1; i < LEVELS; i++) root = poseidon2([root, ZEROS[i]]);

  // path for leaf at index 0: sibling at each level
  const pathElements0 = [leafDummy.toString()];
  for (let i = 1; i < LEVELS; i++) pathElements0.push(ZEROS[i].toString());

  const sig0 = sign(depNote.priv, leaf, 0n);
  const null0 = nullify(leaf, 0n, sig0);
  const inDummy = dummyInput();
  const publicAmount = (P - W) % P;
  const wExtHash = 67890n;

  console.log("\n=== GENERATING WITHDRAW PROOF (50 XLM, change 87) ===");
  const wd = await prove({
    root: root.toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: wExtHash.toString(),
    inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
    outputCommitment: [noteCommit(change).toString(), noteCommit(outZero).toString()],
    inAmount: [D.toString(), "0"],
    inPrivateKey: [depNote.priv.toString(), inDummy.priv.toString()],
    inBlinding: [depNote.blinding.toString(), inDummy.blinding.toString()],
    inPathIndices: ["0", "0"],
    inPathElements: [pathElements0, inDummy.pathElements],
    outAmount: [(D - W).toString(), "0"],
    outPubkey: [pubKey(change.priv).toString(), pubKey(outZero.priv).toString()],
    outBlinding: [change.blinding.toString(), outZero.blinding.toString()],
  });

  const wdStroops = -Number(W) * 10000000;
  console.log("WITHDRAW_PROOF=" + wd.proofHex);
  console.log("WITHDRAW_ROOT=" + beHex(root));
  console.log("WITHDRAW_EXT_AMOUNT=" + wdStroops);
  console.log("WITHDRAW_EXT_DATA_HASH=" + beHex(wExtHash));
  console.log("WITHDRAW_NULL0=" + beHex(null0));
  console.log("WITHDRAW_NULL1=" + beHex(inDummy.nullifier));
  console.log("WITHDRAW_OUT0=" + beHex(noteCommit(change)));
  console.log("WITHDRAW_OUT1=" + beHex(noteCommit(outZero)));

  console.log("\n=== DONE: deposit 137, withdraw 50, change 87 ===");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
