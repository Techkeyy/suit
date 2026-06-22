// SUIT — compute a note + a real withdrawal proof for an on-chain test.
// Prints KEY=VALUE hex lines for the shell to feed into the pool v2 deposit/withdraw.
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2 } = require("poseidon-lite");
const path = require("path");

const LEVELS = 16;
const B = path.join(__dirname, "../circuits/circom/build_withdraw");

const beHex = (v, n = 32) => {
  let x = BigInt(v);
  const o = Buffer.alloc(n);
  for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o.toString("hex");
};

(async () => {
  // fixed note for the test
  const nullifier = 12345n;
  const secret = 67890n;
  const recipientField = 11111n; // bound into the proof (independent of payout address in v1)

  const commitment = poseidon2([nullifier, secret]);
  const nullifierHash = poseidon1([nullifier]);

  // zero subtrees (zero leaf = 0)
  const zeros = [0n];
  for (let i = 1; i <= LEVELS; i++) zeros.push(poseidon2([zeros[i - 1], zeros[i - 1]]));

  // leaf at index 0 → siblings are zero subtrees, all left
  const pathElements = [], pathIndices = [];
  let cur = commitment;
  for (let i = 0; i < LEVELS; i++) {
    pathElements.push(zeros[i].toString());
    pathIndices.push(0);
    cur = poseidon2([cur, zeros[i]]);
  }
  const root = cur;

  const input = {
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipientField.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements,
    pathIndices,
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(B, "Withdraw_js/Withdraw.wasm"),
    path.join(B, "Withdraw_final.zkey")
  );

  // sanity: local verify
  const vk = require(path.join(B, "withdraw_vk.json"));
  const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
  if (!ok) { console.error("LOCAL VERIFY FAILED"); process.exit(1); }

  // encode proof to BN254 soroban bytes (BE-32, Fq2 = c1||c0)
  const be = (d, n) => { let v = BigInt(d); const o = Buffer.alloc(n); for (let i = n - 1; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
  const g1 = p => Buffer.concat([be(p[0], 32), be(p[1], 32)]);
  const g2 = p => Buffer.concat([be(p[0][1], 32), be(p[0][0], 32), be(p[1][1], 32), be(p[1][0], 32)]);
  const proofHex = Buffer.concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]).toString("hex");

  console.log("COMMITMENT=" + beHex(commitment));
  console.log("ROOT=" + beHex(root));
  console.log("NULLIFIERHASH=" + beHex(nullifierHash));
  console.log("RECIPIENTFIELD=" + beHex(recipientField));
  console.log("PROOF=" + proofHex);
})().catch((e) => { console.error(e); process.exit(1); });
