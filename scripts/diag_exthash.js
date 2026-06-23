// SUIT — parity check: does the browser's extDataHash equal the contract's?
//
// The pool binds the withdrawal destination by recomputing
//   ext_data_hash = keccak256(recipient_xdr ‖ relayer_xdr ‖ fee_be)  (low 31 bytes)
// and feeding it into the verified public signals. The browser must produce the
// IDENTICAL field element or every relayed proof would be rejected. This script
// computes it in JS and compares against the contract's compute_ext_data_hash view.
const { keccak256 } = require("js-sha3");
const {
  rpc, TransactionBuilder, Contract, Address, xdr,
  nativeToScVal, scValToNative, Networks, BASE_FEE,
} = require("@stellar/stellar-sdk");

const POOL = process.env.SUIT_POOL || "CDGGJTTWSOGHKO6GCZTZQUIO4U2Y5PUQOSAWESGUUC74QUXDHGIPPX6X";
const SRC = process.env.SUIT_SRC || "GDXRUIKQZZ34JGHDN2FD2JJHK7G4BLMJWOTGKOZFNGUF2I3TOP63TD64";
const server = new rpc.Server("https://soroban-testnet.stellar.org");

// JS side — must mirror compute_ext_hash() in pool_v3/src/lib.rs exactly.
function extHashJS(recipient, relayer, fee) {
  const rb = new Uint8Array(new Address(recipient).toScVal().toXDR());
  const lb = new Uint8Array(new Address(relayer).toScVal().toXDR());
  const fb = new Uint8Array(16);
  let x = BigInt(fee);
  for (let i = 15; i >= 0; i--) { fb[i] = Number(x & 0xffn); x >>= 8n; }
  const data = new Uint8Array(rb.length + lb.length + 16);
  data.set(rb, 0); data.set(lb, rb.length); data.set(fb, rb.length + lb.length);
  const d = new Uint8Array(keccak256.arrayBuffer(data));
  const fld = new Uint8Array(32); // byte 0 stays zero (field reduction)
  fld.set(d.slice(1), 1);
  return Buffer.from(fld).toString("hex");
}

async function contractHash(recipient, relayer, fee) {
  const acct = await server.getAccount(SRC);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(POOL).call(
      "compute_ext_data_hash",
      new Address(recipient).toScVal(),
      new Address(relayer).toScVal(),
      nativeToScVal(fee, { type: "i128" }),
    )).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error("sim: " + sim.error);
  const ret = scValToNative(sim.result.retval);
  return Buffer.from(ret).toString("hex");
}

(async () => {
  const cases = [
    ["GC2Q2S47LNBPW7D466IINEOA4Q4R576X6VWM43XMX5TQCYO7ZH43XCJL", SRC, 0n],
    ["GC2Q2S47LNBPW7D466IINEOA4Q4R576X6VWM43XMX5TQCYO7ZH43XCJL", SRC, 20000000n],
    [SRC, SRC, 0n],
    [POOL, SRC, 5n], // contract-address recipient
  ];
  let allOk = true;
  for (const [r, l, f] of cases) {
    const js = extHashJS(r, l, f);
    const cx = await contractHash(r, l, f);
    const ok = js === cx;
    allOk = allOk && ok;
    console.log(`${ok ? "✓ MATCH" : "✗ MISMATCH"}  recipient=${r.slice(0,6)} relayer=${l.slice(0,6)} fee=${f}`);
    if (!ok) { console.log("    js:       " + js); console.log("    contract: " + cx); }
  }
  console.log(allOk ? "\nALL MATCH — browser & contract agree on the binding." : "\nMISMATCH — fix the JS encoding before wiring the app.");
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
