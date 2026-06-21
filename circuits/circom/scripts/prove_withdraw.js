// SUIT — generate + verify a sample withdrawal proof off-chain.
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2 } = require("poseidon-lite");
const fs = require("fs");
const path = require("path");

const LEVELS = 16;

async function main() {
  const B = path.join(__dirname, "../build_withdraw");

  // a note
  const nullifier = 1n;
  const secret = 2n;
  const commitment = poseidon2([nullifier, secret]);
  const nullifierHash = poseidon1([nullifier]);

  // zero subtrees (zero leaf = 0)
  const zeros = [0n];
  for (let i = 1; i <= LEVELS; i++) zeros.push(poseidon2([zeros[i - 1], zeros[i - 1]]));

  // leaf at index 0 → every sibling is the zero subtree, every direction bit 0
  const pathElements = [];
  const pathIndices = [];
  let cur = commitment;
  for (let i = 0; i < LEVELS; i++) {
    pathElements.push(zeros[i].toString());
    pathIndices.push(0);
    cur = poseidon2([cur, zeros[i]]);
  }
  const root = cur;

  // recipient bound into the proof (placeholder field element for the test)
  const recipient = 12345n;

  const input = {
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipient.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements,
    pathIndices,
  };
  fs.writeFileSync(path.join(B, "withdraw_input.json"), JSON.stringify(input, null, 2));

  console.log("commitment:", commitment.toString());
  console.log("root:", root.toString());
  console.log("nullifierHash:", nullifierHash.toString());

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(B, "Withdraw_js/Withdraw.wasm"),
    path.join(B, "Withdraw_final.zkey")
  );
  fs.writeFileSync(path.join(B, "withdraw_proof.json"), JSON.stringify(proof, null, 2));
  fs.writeFileSync(path.join(B, "withdraw_public.json"), JSON.stringify(publicSignals, null, 2));

  const vk = JSON.parse(fs.readFileSync(path.join(B, "withdraw_vk.json")));
  const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
  console.log("publicSignals:", publicSignals);
  console.log("LOCAL VERIFY:", ok);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
