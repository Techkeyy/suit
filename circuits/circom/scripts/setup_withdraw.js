// SUIT — trusted setup for the withdrawal circuit (BN254 / bn128).
const snarkjs = require("snarkjs");
const ffjavascript = require("ffjavascript");
const fs = require("fs");
const path = require("path");

async function main() {
  const B = path.join(__dirname, "../build_withdraw");
  const ptau0 = path.join(B, "pot14_0000.ptau");
  const ptau1 = path.join(B, "pot14_0001.ptau");
  const ptauF = path.join(B, "pot14_final.ptau");
  const zkey0 = path.join(B, "Withdraw_0000.zkey");
  const zkeyF = path.join(B, "Withdraw_final.zkey");
  const vkey = path.join(B, "withdraw_vk.json");
  const r1cs = path.join(B, "Withdraw.r1cs");

  console.log("1. bn128 curve...");
  const curve = await ffjavascript.buildBn128();
  console.log("2. powers of tau (2^14)...");
  await snarkjs.powersOfTau.newAccumulator(curve, 14, ptau0);
  await snarkjs.powersOfTau.contribute(ptau0, ptau1, "suit-w-1", "withdraw_entropy_1");
  console.log("3. prepare phase2...");
  await snarkjs.powersOfTau.preparePhase2(ptau1, ptauF);
  console.log("4. zkey...");
  await snarkjs.zKey.newZKey(r1cs, ptauF, zkey0);
  await snarkjs.zKey.contribute(zkey0, zkeyF, "suit-w-2", "withdraw_entropy_2");
  console.log("5. export vk...");
  const vk = await snarkjs.zKey.exportVerificationKey(zkeyF);
  fs.writeFileSync(vkey, JSON.stringify(vk, null, 2));
  await curve.terminate();
  console.log("done:", vkey);
}
main().catch((e) => { console.error(e); process.exit(1); });
