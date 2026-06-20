const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

async function verifyLocal() {
  console.log("=== SUIT Local Proof Verification ===");

  const buildDir = path.join(__dirname, "../build");

  const vKey = JSON.parse(
    fs.readFileSync(path.join(buildDir, "verification_key.json"), "utf8")
  );
  const proof = JSON.parse(
    fs.readFileSync(path.join(buildDir, "proof.json"), "utf8")
  );
  const publicSignals = JSON.parse(
    fs.readFileSync(path.join(buildDir, "public_signals.json"), "utf8")
  );

  console.log("Verifying proof locally...");
  const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);

  if (isValid) {
    console.log("✓ Proof is VALID");
    console.log("  This proof is ready for on-chain verification.");
    console.log("  Public signals:", publicSignals);
  } else {
    console.log("✗ Proof is INVALID");
    console.log("  Do not submit this proof to the chain.");
    process.exit(1);
  }

  // Export hex-encoded bytes for Soroban contract submission
  console.log("\nExporting hex-encoded bytes for Soroban...");
  const calldata = await snarkjs.groth16.exportSolidityCallData(
    proof,
    publicSignals
  );
  fs.writeFileSync(path.join(buildDir, "calldata.json"), calldata);
  console.log("  Calldata written to build/calldata.json");
}

verifyLocal().catch(console.error);
