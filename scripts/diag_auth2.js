// SUIT — enhanced auth diagnostic. Deposits, then builds a withdraw, and dumps
// the FULL Soroban auth structure of both assembled txs (credential type, inner
// address, root-invocation function). Goal: see exactly what Freighter signs and
// why withdraw differs from the working deposit. Does NOT submit the withdraw.
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");
const crypto = require("crypto");
const path = require("path");
const {
  rpc, TransactionBuilder, Contract, Address, Keypair, xdr,
  nativeToScVal, scValToNative, Networks, BASE_FEE,
} = require("@stellar/stellar-sdk");

const NETWORK = Networks.TESTNET;
const POOL = process.env.SUIT_POOL || "CAXFFBZHC7CFYFOQSMV57TAY2CEO6Y2GMOQKLKSERD4O4DBMLFSMDA63";
const START = Number(process.env.SUIT_START || 3236050);
const SECRET = process.env.SUIT_SECRET;
const LEVELS = 16;
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const B = path.join(__dirname, "../circuits/circom/build_tx");
const WASM = path.join(B, "Transaction_js/Transaction.wasm");
const ZKEY = path.join(B, "Transaction_final.zkey");

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const kp = Keypair.fromSecret(SECRET);
const SRC = kp.publicKey();

const rnd = () => BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
const pubKey = p => poseidon1([p]);
const commit = (a, pk, b) => poseidon3([a, pk, b]);
const sign = (p, c, i) => poseidon3([p, c, i]);
const nullify = (c, i, s) => poseidon3([c, i, s]);
const be = (v, n = 32) => { let x = ((BigInt(v) % P) + P) % P; const o = Buffer.alloc(n); for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const b2big = b => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };
const g1 = p => Buffer.concat([be(p[0]), be(p[1])]);
const g2 = p => Buffer.concat([be(p[0][1]), be(p[0][0]), be(p[1][1]), be(p[1][0])]);
const scv = b => xdr.ScVal.scvBytes(b);
const ZEROS = [0n]; for (let i = 1; i <= LEVELS; i++) ZEROS.push(poseidon2([ZEROS[i - 1], ZEROS[i - 1]]));
const emptyPath = () => ZEROS.slice(0, LEVELS).map(z => z.toString());
function treeRoot(L) { if (!L.length) return ZEROS[LEVELS]; let a = L.slice(); for (let d = 0; d < LEVELS; d++) { const n = []; const len = Math.max(a.length, 1); for (let i = 0; i < len; i += 2) n.push(poseidon2([i < a.length ? a[i] : ZEROS[d], i + 1 < a.length ? a[i + 1] : ZEROS[d]])); a = n; } return a[0]; }
function treePath(idx, L) { const p = []; let a = L.slice(); let k = idx; for (let d = 0; d < LEVELS; d++) { const s = k % 2 === 0 ? k + 1 : k - 1; p.push(s >= 0 && s < a.length ? a[s] : ZEROS[d]); const n = []; const len = Math.max(a.length, 1); for (let i = 0; i < len; i += 2) n.push(poseidon2([i < a.length ? a[i] : ZEROS[d], i + 1 < a.length ? a[i + 1] : ZEROS[d]])); a = n; k = Math.floor(k / 2); } return p; }
function dummyInput() { const p = rnd(), b = rnd(); const c = commit(0n, pubKey(p), b); return { priv: p, blinding: b, nullifier: nullify(c, 0n, sign(p, c, 0n)), pathElements: emptyPath() }; }
async function syncLeaves() {
  const idx = new Map(); const filters = [{ type: "contract", contractIds: [POOL], topics: [["*"]] }];
  let res = await server.getEvents({ startLedger: START, filters, limit: 200 });
  const collect = evs => { for (const e of evs) { try { const d = scValToNative(e.value); if (d && typeof d.leaf_index !== "undefined" && d.out_commitment_0) { idx.set(Number(d.leaf_index), b2big(d.out_commitment_0)); idx.set(Number(d.leaf_index) + 1, b2big(d.out_commitment_1)); } } catch {} } };
  collect(res.events);
  while (res.events.length === 200 && res.cursor) { res = await server.getEvents({ filters, limit: 200, cursor: res.cursor }); collect(res.events); }
  const max = idx.size ? Math.max(...idx.keys()) : -1; const L = []; for (let i = 0; i <= max; i++) L.push(idx.get(i) ?? 0n); return L;
}
async function proveRaw(input) { const { proof } = await snarkjs.groth16.fullProve(input, WASM, ZKEY); return Buffer.concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]); }
async function view(method) { const acct = await server.getAccount(SRC); const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NETWORK }).addOperation(new Contract(POOL).call(method)).setTimeout(30).build(); const sim = await server.simulateTransaction(tx); return scValToNative(sim.result.retval); }

function dumpAuthDeep(label, tx) {
  const op = tx.operations[0];
  const auths = op.auth || [];
  console.log(`\n========== [${label}] ==========`);
  console.log(`op type: ${op.type}`);
  console.log(`auth entries: ${auths.length}`);
  auths.forEach((a, i) => {
    const cred = a.credentials();
    const sw = cred.switch().name;
    console.log(`  entry #${i}: credential = ${sw}`);
    if (sw === "sorobanCredentialsAddress") {
      const ac = cred.address();
      const addr = Address.fromScAddress(ac.address()).toString();
      console.log(`      address       = ${addr}`);
      console.log(`      nonce         = ${ac.nonce().toString()}`);
      console.log(`      sigExpLedger  = ${ac.signatureExpirationLedger()}`);
      console.log(`      signature set = ${ac.signature().switch ? 'vec' : JSON.stringify(ac.signature())}`);
    }
    const root = a.rootInvocation();
    const fn = root.function();
    const fnSw = fn.switch().name;
    let fname = fnSw;
    if (fnSw === "sorobanAuthorizedFunctionTypeContractFn") {
      const c = fn.contractFn();
      fname = `${Address.fromScAddress(c.contractAddress()).toString()}::${c.functionName().toString()}`;
    }
    console.log(`      rootInvocation= ${fname}`);
    console.log(`      subInvocations= ${root.subInvocations().length}`);
    root.subInvocations().forEach((s, j) => {
      const sf = s.function();
      if (sf.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
        const c = sf.contractFn();
        console.log(`         sub#${j}: ${Address.fromScAddress(c.contractAddress()).toString()}::${c.functionName().toString()}`);
      } else {
        console.log(`         sub#${j}: ${sf.switch().name}`);
      }
    });
  });
  // Soroban resource data
  try {
    const sd = tx.toEnvelope().v1().tx().ext().sorobanData();
    console.log(`  resourceFee   = ${sd.resourceFee().toString()}`);
  } catch (e) { console.log(`  (no sorobanData: ${e.message})`); }
  console.log(`  tx.fee        = ${tx.fee}`);
  console.log(`  tx hash (hex) = ${tx.hash().toString("hex")}`);
}

(async () => {
  console.log("POOL:", POOL, "\nSRC :", SRC);

  // fresh deposit
  let leaves = await syncLeaves();
  const D = 6n * 10000000n;
  const priv = rnd(), blinding = rnd(), pk = pubKey(priv);
  const outCommit = commit(D, pk, blinding);
  const dPriv = rnd(), dBlind = rnd(), dPk = pubKey(dPriv);
  const dummyCommit = commit(0n, dPk, dBlind);
  const inA = dummyInput(), inB = dummyInput();
  const depRoot = b2big(await view("get_root"));
  const depProof = await proveRaw({
    root: depRoot.toString(), publicAmount: D.toString(), extDataHash: "0",
    inputNullifier: [inA.nullifier.toString(), inB.nullifier.toString()],
    outputCommitment: [outCommit.toString(), dummyCommit.toString()],
    inAmount: ["0", "0"], inPrivateKey: [inA.priv.toString(), inB.priv.toString()],
    inBlinding: [inA.blinding.toString(), inB.blinding.toString()],
    inPathIndices: ["0", "0"], inPathElements: [inA.pathElements, inB.pathElements],
    outAmount: [D.toString(), "0"], outPubkey: [pk.toString(), dPk.toString()],
    outBlinding: [blinding.toString(), dBlind.toString()],
  });
  const c = new Contract(POOL);
  const depOp = c.call("transact", scv(depProof), scv(be(depRoot)), nativeToScVal(D, { type: "i128" }), scv(be(0n)),
    xdr.ScVal.scvVec([scv(be(inA.nullifier)), scv(be(inB.nullifier))]),
    xdr.ScVal.scvVec([scv(be(outCommit)), scv(be(dummyCommit))]),
    new Address(SRC).toScVal(), new Address(SRC).toScVal());
  let acct = await server.getAccount(SRC);
  let depTx = new TransactionBuilder(acct, { fee: (Number(BASE_FEE) * 1000).toString(), networkPassphrase: NETWORK }).addOperation(depOp).setTimeout(300).build();
  let depSim = await server.simulateTransaction(depTx);
  if (rpc.Api.isSimulationError(depSim)) { console.log("DEP SIM ERR:", depSim.error); process.exit(1); }
  const depAssembled = rpc.assembleTransaction(depTx, depSim).build();
  dumpAuthDeep("DEPOSIT assembled", depAssembled);
  depAssembled.sign(kp);
  const sent = await server.sendTransaction(depAssembled);
  console.log("\ndeposit submit:", sent.status, sent.hash || "");
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1500)); const g = await server.getTransaction(sent.hash); if (g.status !== "NOT_FOUND") { console.log("deposit final:", g.status); break; } }

  // build WITHDRAW (no submit)
  leaves = await syncLeaves();
  const myIdx = leaves.findIndex(l => l === outCommit);
  console.log("\nnote leaf index:", myIdx, "of", leaves.length, "leaves");
  const root = treeRoot(leaves);
  const W = 3n * 10000000n; // partial
  const change = D - W;
  const sig0 = sign(priv, outCommit, BigInt(myIdx));
  const null0 = nullify(outCommit, BigInt(myIdx), sig0);
  const inDummy = dummyInput();
  const cPriv = rnd(), cBlind = rnd(), cCommit = commit(change, pubKey(cPriv), cBlind);
  const zPriv = rnd(), zBlind = rnd(), zCommit = commit(0n, pubKey(zPriv), zBlind);
  const recipient = "GC2Q2S47LNBPW7D466IINEOA4Q4R576X6VWM43XMX5TQCYO7ZH43XCJL";
  const wProof = await proveRaw({
    root: root.toString(), publicAmount: ((P - W) % P).toString(), extDataHash: "0",
    inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
    outputCommitment: [cCommit.toString(), zCommit.toString()],
    inAmount: [D.toString(), "0"], inPrivateKey: [priv.toString(), inDummy.priv.toString()],
    inBlinding: [blinding.toString(), inDummy.blinding.toString()],
    inPathIndices: [myIdx.toString(), "0"], inPathElements: [treePath(myIdx, leaves).map(x => x.toString()), inDummy.pathElements],
    outAmount: [change.toString(), "0"], outPubkey: [pubKey(cPriv).toString(), pubKey(zPriv).toString()],
    outBlinding: [cBlind.toString(), zBlind.toString()],
  });
  const wOp = c.call("transact", scv(wProof), scv(be(root)), nativeToScVal(-W, { type: "i128" }), scv(be(0n)),
    xdr.ScVal.scvVec([scv(be(null0)), scv(be(inDummy.nullifier))]),
    xdr.ScVal.scvVec([scv(be(cCommit)), scv(be(zCommit))]),
    new Address(SRC).toScVal(), new Address(recipient).toScVal());
  acct = await server.getAccount(SRC);
  let wTx = new TransactionBuilder(acct, { fee: (Number(BASE_FEE) * 1000).toString(), networkPassphrase: NETWORK }).addOperation(wOp).setTimeout(300).build();
  let wSim = await server.simulateTransaction(wTx);
  if (rpc.Api.isSimulationError(wSim)) { console.log("WITHDRAW SIM ERROR:", wSim.error); process.exit(1); }
  const wAssembled = rpc.assembleTransaction(wTx, wSim).build();
  dumpAuthDeep("WITHDRAW assembled", wAssembled);
  console.log("\n(diagnostic only — withdraw not submitted)");
  process.exit(0);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(1); });
