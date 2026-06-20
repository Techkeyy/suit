const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

async function prove() {
  console.log("=== SUIT Range Proof Generator ===");

  const buildDir = path.join(__dirname, "../build");

  // Test inputs — in production these come from the SDK
  // amount = 1000 USDC (in base units, e.g. 1000_0000000 = 10,000,000,000)
  // min = 100 USDC, max = 10000 USDC
  const amount = BigInt("10000000000");      // 1000 USDC (7 decimals)
  const secret = BigInt("98765432109876");   // random blinding factor
  const min_amount = BigInt("1000000000");   // 100 USDC
  const max_amount = BigInt("100000000000"); // 10000 USDC
  const commitment = amount + secret;        // simplified commitment

  const input = {
    amount: amount.toString(),
    secret: secret.toString(),
    min_amount: min_amount.toString(),
    max_amount: max_amount.toString(),
    commitment: commitment.toString(),
  };

  console.log("Inputs:");
  console.log("  amount:     [PRIVATE]");
  console.log("  secret:     [PRIVATE]");
  console.log("  min_amount:", min_amount.toString());
  console.log("  max_amount:", max_amount.toString());
  console.log("  commitment:", commitment.toString());

  // Save input for witness generation
  fs.writeFileSync(
    path.join(buildDir, "input.json"),
    JSON.stringify(input, null, 2)
  );

  console.log("\nGenerating witness...");
  const wasmPath = path.join(buildDir, "RangeProof_js/RangeProof.wasm");
  const zkeyPath = path.join(buildDir, "RangeProof_final.zkey");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  fs.writeFileSync(
    path.join(buildDir, "proof.json"),
    JSON.stringify(proof, null, 2)
  );
  fs.writeFileSync(
    path.join(buildDir, "public_signals.json"),
    JSON.stringify(publicSignals, null, 2)
  );

  console.log("\nProof generated successfully.");
  console.log("  Public signals (on-chain):", publicSignals);
  console.log("  Proof written to build/proof.json");
  console.log("  Public signals written to build/public_signals.json");
}

prove().catch(console.error);
