// SUIT — validate the Nova transaction circuit: a deposit and a withdraw-with-change.
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");
const crypto = require("crypto");
const path = require("path");

const LEVELS = 16;
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const B = path.join(__dirname, "../build_tx");
const WASM = path.join(B, "Transaction_js/Transaction.wasm");
const ZKEY = path.join(B, "Transaction_final.zkey");
const VK = require(path.join(B, "transaction_vk.json"));

const rnd = () => BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
const pubKey = (priv) => poseidon1([priv]);
const commit = (amount, pk, blinding) => poseidon3([amount, pk, blinding]);
const sign = (priv, c, idx) => poseidon3([priv, c, idx]);
const nullify = (c, idx, sig) => poseidon3([c, idx, sig]);

const ZEROS = [0n];
for (let i = 1; i <= LEVELS; i++) ZEROS.push(poseidon2([ZEROS[i - 1], ZEROS[i - 1]]));

function emptyPath() { return ZEROS.slice(0, LEVELS).map((z) => z.toString()); }

function dummyInput() {
  const priv = rnd(), blinding = rnd(), amount = 0n, idx = 0n;
  const c = commit(amount, pubKey(priv), blinding);
  const sig = sign(priv, c, idx);
  return {
    amount, priv, blinding, idx,
    pathElements: emptyPath(),
    nullifier: nullify(c, idx, sig),
  };
}

function makeNote(amount) {
  return { amount, priv: rnd(), blinding: rnd() };
}
function noteCommit(n) { return commit(n.amount, pubKey(n.priv), n.blinding); }

async function run(label, input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ok = await snarkjs.groth16.verify(VK, publicSignals, proof);
  console.log(`${label}: ${ok ? "VERIFY ✓" : "FAIL ✗"}`);
  if (!ok) process.exit(1);
}

(async () => {
  // ---- DEPOSIT 137 (2 dummy inputs, output[0]=137-note) ----
  const D = 137n;
  const depNote = makeNote(D);          // becomes a tree leaf at index 0
  const outDummy = makeNote(0n);
  const inA = dummyInput(), inB = dummyInput();

  await run("deposit", {
    root: "0",
    publicAmount: D.toString(),
    extDataHash: "12345",
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

  // ---- WITHDRAW 50 from the 137-note (change = 87) ----
  const W = 50n;
  const change = makeNote(D - W);
  const outZero = makeNote(0n);
  const leaf = noteCommit(depNote);
  // tree with leaf at index 0 → root, path = zero subtrees
  let cur = leaf;
  for (let i = 0; i < LEVELS; i++) cur = poseidon2([cur, ZEROS[i]]);
  const root = cur;
  const sig0 = sign(depNote.priv, leaf, 0n);
  const null0 = nullify(leaf, 0n, sig0);
  const inDummy = dummyInput();
  const publicAmount = (P - W) % P; // withdraw = negative

  await run("withdraw", {
    root: root.toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: "67890",
    inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
    outputCommitment: [noteCommit(change).toString(), noteCommit(outZero).toString()],
    inAmount: [D.toString(), "0"],
    inPrivateKey: [depNote.priv.toString(), inDummy.priv.toString()],
    inBlinding: [depNote.blinding.toString(), inDummy.blinding.toString()],
    inPathIndices: ["0", "0"],
    inPathElements: [emptyPath(), inDummy.pathElements],
    outAmount: [(D - W).toString(), "0"],
    outPubkey: [pubKey(change.priv).toString(), pubKey(outZero.priv).toString()],
    outBlinding: [change.blinding.toString(), outZero.blinding.toString()],
  });

  console.log("Nova circuit validated: arbitrary-amount deposit + withdraw-with-change.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
