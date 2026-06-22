// SUIT — trusted setup for the Nova transaction circuit (bn128, 2^15).
const snarkjs = require("snarkjs");
const ffjavascript = require("ffjavascript");
const fs = require("fs");
const path = require("path");

async function main() {
  const B = path.join(__dirname, "../build_tx");
  const p0 = path.join(B, "pot15_0000.ptau");
  const p1 = path.join(B, "pot15_0001.ptau");
  const pf = path.join(B, "pot15_final.ptau");
  const z0 = path.join(B, "Transaction_0000.zkey");
  const zf = path.join(B, "Transaction_final.zkey");
  const vk = path.join(B, "transaction_vk.json");
  const r1cs = path.join(B, "Transaction.r1cs");

  console.log("1. bn128…");
  const curve = await ffjavascript.buildBn128();
  console.log("2. powers of tau 2^15…");
  await snarkjs.powersOfTau.newAccumulator(curve, 15, p0);
  await snarkjs.powersOfTau.contribute(p0, p1, "suit-tx-1", "tx_entropy_1");
  console.log("3. prepare phase2…");
  await snarkjs.powersOfTau.preparePhase2(p1, pf);
  console.log("4. zkey…");
  await snarkjs.zKey.newZKey(r1cs, pf, z0);
  await snarkjs.zKey.contribute(z0, zf, "suit-tx-2", "tx_entropy_2");
  console.log("5. export vk…");
  fs.writeFileSync(vk, JSON.stringify(await snarkjs.zKey.exportVerificationKey(zf), null, 2));
  await curve.terminate();
  console.log("done:", vk);
}
main().catch((e) => { console.error(e); process.exit(1); });
