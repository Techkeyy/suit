const snarkjs = require("snarkjs");
const ffjavascript = require("ffjavascript");
const fs = require("fs");
const path = require("path");

async function setup() {
  console.log("=== SUIT Circom Trusted Setup ===");

  const buildDir = path.join(__dirname, "../build");
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

  const ptau0     = path.join(buildDir, "pot12_0000.ptau");
  const ptau1     = path.join(buildDir, "pot12_0001.ptau");
  const ptauFinal = path.join(buildDir, "pot12_final.ptau");
  const zkey0     = path.join(buildDir, "RangeProof_0000.zkey");
  const zkeyFinal = path.join(buildDir, "RangeProof_final.zkey");
  const vkeyPath  = path.join(buildDir, "verification_key.json");
  const r1csPath  = path.join(buildDir, "RangeProof.r1cs");

  console.log("1. Building BLS12-381 curve...");
  // SUIT verifies proofs on-chain using Stellar's BLS12-381 pairing host
  // functions, so the entire pipeline (ptau, zkey, proof) must be over
  // BLS12-381 — not the snarkjs default BN128.
  const curve = await ffjavascript.buildBls12381();
  console.log("   Curve built. F1 keys:", Object.keys(curve.F1).slice(0,5).join(", "));

  console.log("2. Generating Powers of Tau...");
  await snarkjs.powersOfTau.newAccumulator(curve, 12, ptau0);
  console.log("   pot12_0000.ptau written.");

  console.log("3. Contributing to ceremony...");
  await snarkjs.powersOfTau.contribute(ptau0, ptau1, "SUIT First Contribution", "suit_entropy_001");
  console.log("   pot12_0001.ptau written.");

  console.log("4. Preparing phase 2...");
  await snarkjs.powersOfTau.preparePhase2(ptau1, ptauFinal);
  console.log("   pot12_final.ptau written.");

  console.log("5. Generating zkey...");
  await snarkjs.zKey.newZKey(r1csPath, ptauFinal, zkey0);
  console.log("   RangeProof_0000.zkey written.");

  console.log("6. Contributing to zkey...");
  await snarkjs.zKey.contribute(zkey0, zkeyFinal, "SUIT ZKey Contribution", "suit_entropy_002");
  console.log("   RangeProof_final.zkey written.");

  console.log("7. Exporting verification key...");
  const vKey = await snarkjs.zKey.exportVerificationKey(zkeyFinal);
  fs.writeFileSync(vkeyPath, JSON.stringify(vKey, null, 2));
  console.log("   verification_key.json written.");

  await curve.terminate();
  console.log("");
  console.log("=== Setup complete ===");
}

setup().catch((err) => {
  console.error("Setup failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
