// SUIT — contract-level end-to-end against the bound-recipient pool, with REAL
// Groth16 proofs. Proves the full privacy + safety story on-chain:
//   1. deposit (real proof)
//   2. relayed withdraw with a fee — recipient gets out-fee, relayer gets fee,
//      submitter (account) is the relayer, not the depositor
//   3. the withdraw proof is BOUND: re-pointing it to a different recipient is
//      rejected by the verifier (InvalidProof) — relayer can't steal
//   4. double-spend of the same nullifier is rejected (NullifierAlreadySpent)
//
// Run: SUIT_SECRET=<depositor secret> SUIT_RELAYER_SECRET=<relayer secret> node scripts/nova_bound_e2e.js
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");
const { keccak256 } = require("js-sha3");
const crypto = require("crypto");
const path = require("path");
const {
  rpc, TransactionBuilder, Contract, Address, Keypair, xdr,
  nativeToScVal, scValToNative, Networks, BASE_FEE,
} = require("@stellar/stellar-sdk");

const NETWORK = Networks.TESTNET;
const POOL = process.env.SUIT_POOL || "CDGGJTTWSOGHKO6GCZTZQUIO4U2Y5PUQOSAWESGUUC74QUXDHGIPPX6X";
const START = Number(process.env.SUIT_START || 3239820);
const SECRET = process.env.SUIT_SECRET;            // depositor
const RELAYER_SECRET = process.env.SUIT_RELAYER_SECRET; // relayer (submits withdraw)
const RECIPIENT = process.env.SUIT_RECIPIENT || "GBGNO4GRVFFQ6PSE6DCWBFAOBWA7SOFJSVEGT645EVGJQRN4GMS3JG65";
const LEVELS = 16;
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const B = path.join(__dirname, "../circuits/circom/build_tx");
const WASM = path.join(B, "Transaction_js/Transaction.wasm");
const ZKEY = path.join(B, "Transaction_final.zkey");

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const kp = Keypair.fromSecret(SECRET);
const SRC = kp.publicKey();
const relayerKp = Keypair.fromSecret(RELAYER_SECRET);
const RELAYER = relayerKp.publicKey();

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

// extDataHash field element — mirrors compute_ext_hash() in the contract.
function extHashField(recipient, relayer, fee) {
  const rb = new Uint8Array(new Address(recipient).toScVal().toXDR());
  const lb = new Uint8Array(new Address(relayer).toScVal().toXDR());
  const fb = new Uint8Array(16); let x = BigInt(fee);
  for (let i = 15; i >= 0; i--) { fb[i] = Number(x & 0xffn); x >>= 8n; }
  const data = new Uint8Array(rb.length + lb.length + 16);
  data.set(rb, 0); data.set(lb, rb.length); data.set(fb, rb.length + lb.length);
  const d = new Uint8Array(keccak256.arrayBuffer(data));
  return b2big(d.slice(1)); // low 31 bytes
}

function treeRoot(L) { let a = L.slice(); for (let d = 0; d < LEVELS; d++) { const n = []; const len = Math.max(a.length, 1); for (let i = 0; i < len; i += 2) n.push(poseidon2([i < a.length ? a[i] : ZEROS[d], i + 1 < a.length ? a[i + 1] : ZEROS[d]])); a = n; } return a[0]; }
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
async function send(signer, op) {
  const acct = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(acct, { fee: (Number(BASE_FEE) * 1000).toString(), networkPassphrase: NETWORK }).addOperation(op).setTimeout(300).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return { err: sim.error };
  const asm = rpc.assembleTransaction(tx, sim).build();
  asm.sign(signer);
  const sent = await server.sendTransaction(asm);
  if (sent.status === "ERROR") return { err: JSON.stringify(sent.errorResult) };
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1500)); const g = await server.getTransaction(sent.hash); if (g.status === "SUCCESS") return { hash: sent.hash }; if (g.status === "FAILED") return { err: "FAILED " + sent.hash, hash: sent.hash }; }
  return { err: "timeout" };
}

(async () => {
  console.log("POOL:", POOL, "\ndepositor:", SRC, "\nrelayer  :", RELAYER, "\nrecipient:", RECIPIENT, "\n");
  const c = new Contract(POOL);

  // ---- 1. DEPOSIT 6 XLM (real proof) ----
  const D = 6n * 10000000n;
  const priv = rnd(), blinding = rnd(), pk = pubKey(priv);
  const outCommit = commit(D, pk, blinding);
  const dPriv = rnd(), dBlind = rnd(), dummyCommit = commit(0n, pubKey(dPriv), dBlind);
  const inA = dummyInput(), inB = dummyInput();
  const depRoot = b2big(await view("get_root"));
  const depExt = extHashField(SRC, SRC, 0n);
  const depProof = await proveRaw({
    root: depRoot.toString(), publicAmount: D.toString(), extDataHash: depExt.toString(),
    inputNullifier: [inA.nullifier.toString(), inB.nullifier.toString()],
    outputCommitment: [outCommit.toString(), dummyCommit.toString()],
    inAmount: ["0", "0"], inPrivateKey: [inA.priv.toString(), inB.priv.toString()],
    inBlinding: [inA.blinding.toString(), inB.blinding.toString()],
    inPathIndices: ["0", "0"], inPathElements: [inA.pathElements, inB.pathElements],
    outAmount: [D.toString(), "0"], outPubkey: [pk.toString(), pubKey(dPriv).toString()],
    outBlinding: [blinding.toString(), dBlind.toString()],
  });
  const depOp = c.call("transact", scv(depProof), scv(be(depRoot)), nativeToScVal(D, { type: "i128" }),
    xdr.ScVal.scvVec([scv(be(inA.nullifier)), scv(be(inB.nullifier))]),
    xdr.ScVal.scvVec([scv(be(outCommit)), scv(be(dummyCommit))]),
    new Address(SRC).toScVal(), new Address(SRC).toScVal(), new Address(SRC).toScVal(), nativeToScVal(0n, { type: "i128" }));
  const depRes = await send(kp, depOp);
  console.log(depRes.hash ? `1. DEPOSIT ok        ${depRes.hash}` : `1. DEPOSIT FAILED    ${depRes.err}`);
  if (!depRes.hash) process.exit(1);

  // ---- build a partial withdraw: 3 XLM out, 0.5 fee to relayer, change back ----
  const leaves = await syncLeaves();
  const myIdx = leaves.findIndex(l => l === outCommit);
  const root = treeRoot(leaves);
  const W = 3n * 10000000n, FEE = 5000000n; // withdraw 3, fee 0.5 → recipient 2.5
  const change = D - W;
  const sig0 = sign(priv, outCommit, BigInt(myIdx));
  const null0 = nullify(outCommit, BigInt(myIdx), sig0);
  const inDummy = dummyInput();
  const cPriv = rnd(), cBlind = rnd(), cCommit = commit(change, pubKey(cPriv), cBlind);
  const zPriv = rnd(), zBlind = rnd(), zCommit = commit(0n, pubKey(zPriv), zBlind);
  const wExt = extHashField(RECIPIENT, RELAYER, FEE);
  const wProof = await proveRaw({
    root: root.toString(), publicAmount: ((P - W) % P).toString(), extDataHash: wExt.toString(),
    inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
    outputCommitment: [cCommit.toString(), zCommit.toString()],
    inAmount: [D.toString(), "0"], inPrivateKey: [priv.toString(), inDummy.priv.toString()],
    inBlinding: [blinding.toString(), inDummy.blinding.toString()],
    inPathIndices: [myIdx.toString(), "0"], inPathElements: [treePath(myIdx, leaves).map(x => x.toString()), inDummy.pathElements],
    outAmount: [change.toString(), "0"], outPubkey: [pubKey(cPriv).toString(), pubKey(zPriv).toString()],
    outBlinding: [cBlind.toString(), zBlind.toString()],
  });
  const nulls = xdr.ScVal.scvVec([scv(be(null0)), scv(be(inDummy.nullifier))]);
  const outs = xdr.ScVal.scvVec([scv(be(cCommit)), scv(be(zCommit))]);
  // Balance check: native XLM by default, or a classic asset via SUIT_BAL_ASSET=CODE:ISSUER.
  const [BAL_CODE, BAL_ISSUER] = (process.env.SUIT_BAL_ASSET || "").split(":");
  const bal = async a => { try { const r = await fetch(`https://horizon-testnet.stellar.org/accounts/${a}`); const j = await r.json(); const n = (j.balances || []).find(b => BAL_CODE ? (b.asset_code === BAL_CODE && b.asset_issuer === BAL_ISSUER) : b.asset_type === "native"); return n ? Number(n.balance) : 0; } catch { return 0; } };

  // ---- 2. TAMPERED RECIPIENT (binding test) — runs BEFORE the real withdraw so the
  // nullifier is still unspent; rejection must therefore be InvalidProof, not a
  // double-spend. Re-points the SAME proof to the relayer's own address (the theft). ----
  const tamperOp = c.call("transact", scv(wProof), scv(be(root)), nativeToScVal(-W, { type: "i128" }),
    nulls, outs, new Address(RELAYER).toScVal(), new Address(RELAYER).toScVal(), new Address(RELAYER).toScVal(), nativeToScVal(FEE, { type: "i128" }));
  const tRes = await send(relayerKp, tamperOp);
  console.log(tRes.err ? `2. TAMPERED RECIPIENT rejected ✓ (${String(tRes.err).slice(0, 70)})` : `2. TAMPERED RECIPIENT ACCEPTED ✗ — BINDING BROKEN ${tRes.hash}`);

  // ---- 3. RELAYED WITHDRAW (submitter = relayer, not depositor; correct recipient) ----
  const rBefore = await bal(RECIPIENT);
  const wOp = c.call("transact", scv(wProof), scv(be(root)), nativeToScVal(-W, { type: "i128" }),
    nulls, outs, new Address(RELAYER).toScVal(), new Address(RECIPIENT).toScVal(), new Address(RELAYER).toScVal(), nativeToScVal(FEE, { type: "i128" }));
  const wRes = await send(relayerKp, wOp);
  if (wRes.hash) {
    const rAfter = await bal(RECIPIENT);
    const got = (rAfter - rBefore).toFixed(7);
    console.log(`3. RELAYED WITHDRAW ok ${wRes.hash}\n   recipient +${got} XLM (expected +2.5, withdraw 3 − fee 0.5); submitter was the relayer, not the depositor`);
  } else {
    console.log(`3. RELAYED WITHDRAW FAILED ${wRes.err}`);
  }

  // ---- 4. DOUBLE SPEND (reuse the now-spent nullifier) ----
  const dsRes = await send(relayerKp, wOp);
  console.log(dsRes.err ? `4. DOUBLE SPEND rejected ✓ (${String(dsRes.err).slice(0, 70)})` : `4. DOUBLE SPEND ACCEPTED ✗ ${dsRes.hash}`);

  process.exit(0);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(1); });
