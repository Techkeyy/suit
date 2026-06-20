// Validates the app's exact client path against the LIVE verifier:
//   snarkjs.fullProve (new random amount) -> JS encoder -> on-chain verify().
// Mirrors app/src/lib/suit.ts encoding logic.

const snarkjs = require('snarkjs');
const path = require('path');
const { rpc, TransactionBuilder, Contract, Account, xdr, scValToNative, Networks, BASE_FEE } =
  require('@stellar/stellar-sdk');

const VERIFIER = 'CA2W26LBXZ7FZWKKPW4NHTO52AUYWBAT47S2QMMDDEWORFG4RYQKAWIV';
const MIN = 1_000_000_000n, MAX = 100_000_000_000n;

const be = (v, n) => { let x = BigInt(v); const o = Buffer.alloc(n); for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const u32be = (n) => { const o = Buffer.alloc(4); o.writeUInt32BE(n); return o; };
const g1 = (p) => Buffer.concat([be(p[0], 48), be(p[1], 48)]);
const g2 = (p) => Buffer.concat([be(p[0][1], 48), be(p[0][0], 48), be(p[1][1], 48), be(p[1][0], 48)]);
const encodeProof = (pr) => Buffer.concat([g1(pr.pi_a), g2(pr.pi_b), g1(pr.pi_c)]);
const encodePublic = (s) => Buffer.concat([u32be(s.length), ...s.map((x) => be(x, 32))]);

(async () => {
  // pick a NEW random amount + secret (not the baked-in one)
  const amount = 50_0000000n + BigInt(Math.floor(Math.random() * 1e9)); // ~50 XLM + noise, within bounds
  const secret = BigInt('0x' + require('crypto').randomBytes(20).toString('hex'));
  const commitment = amount + secret;
  const buildDir = path.join(__dirname, '../circuits/circom/build');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { amount: amount.toString(), secret: secret.toString(), min_amount: MIN.toString(), max_amount: MAX.toString(), commitment: commitment.toString() },
    path.join(buildDir, 'RangeProof_js/RangeProof.wasm'),
    path.join(buildDir, 'RangeProof_final.zkey')
  );
  console.log('fresh proof public signals:', publicSignals);

  const proofBytes = encodeProof(proof);
  const publicBytes = encodePublic(publicSignals);

  const server = new rpc.Server('https://soroban-testnet.stellar.org');
  const contract = new Contract(VERIFIER);
  const src = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call('verify', xdr.ScVal.scvBytes(proofBytes), xdr.ScVal.scvBytes(publicBytes)))
    .setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) { console.error('SIM ERROR:', sim.error); process.exit(1); }
  const result = scValToNative(sim.result.retval);
  console.log('on-chain verify(fresh proof) =>', result);
  process.exit(result === true ? 0 : 2);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
