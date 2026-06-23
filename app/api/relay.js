// SUIT — withdrawal relayer (Vercel serverless function).
//
// The relayer submits a user's shielded withdrawal from ITS OWN account, so the
// user's wallet never appears on-chain (sender anonymity). It is NON-CUSTODIAL:
// the proof binds (recipient, relayer, fee) via the on-chain extDataHash, so the
// relayer cannot redirect funds, change the fee, or steal — any tampering makes
// the Groth16 proof fail to verify and the transaction reverts.
//
// GET  /api/relay  → { relayer: <pubkey>, fee, network }
// POST /api/relay  → { poolId, proof, root, extAmount, nullifiers[2],
//                      commitments[2], recipient, fee }  ⇒ { hash } | { error }
//
// Requires env SUIT_RELAYER_SECRET (a funded testnet secret seed). Set it in the
// Vercel project settings — never commit it.
import {
  rpc, TransactionBuilder, Contract, Address, Keypair, xdr,
  nativeToScVal, Networks, BASE_FEE,
} from '@stellar/stellar-sdk';

const RPC = 'https://soroban-testnet.stellar.org';
const NETWORK = Networks.TESTNET;
const FEE = '0'; // demo: relayer runs free (eats gas). Set >0 to charge per withdrawal.

// Only these pools may be relayed (prevents the relayer being used to call
// arbitrary contracts). Keep in sync with TOKENS in src/lib/suit.ts.
const ALLOWED_POOLS = new Set([
  'CDGGJTTWSOGHKO6GCZTZQUIO4U2Y5PUQOSAWESGUUC74QUXDHGIPPX6X', // XLM
  'CARK2WXVBDREA3ARTCGCRHHDXDG4YXSZSU52QIL6BPVPRBV6TTJXD4GS', // USDC
]);

const server = new rpc.Server(RPC);
const hexToBuf = h => Buffer.from(String(h).replace(/^0x/, ''), 'hex');
const scvBytes = b => xdr.ScVal.scvBytes(b);

function relayerKp() {
  const s = process.env.SUIT_RELAYER_SECRET;
  if (!s) throw new Error('Relayer not configured (missing SUIT_RELAYER_SECRET).');
  return Keypair.fromSecret(s);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const kp = relayerKp();
      res.status(200).json({ relayer: kp.publicKey(), fee: FEE, network: 'testnet' });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { poolId, proof, root, extAmount, nullifiers, commitments, recipient, fee } = body;

    // ---- validate ----
    if (!poolId || !ALLOWED_POOLS.has(poolId)) { res.status(400).json({ error: 'Unknown pool.' }); return; }
    if (!proof || !root || !recipient) { res.status(400).json({ error: 'Missing proof/root/recipient.' }); return; }
    if (!Array.isArray(nullifiers) || nullifiers.length !== 2 ||
        !Array.isArray(commitments) || commitments.length !== 2) {
      res.status(400).json({ error: 'Need exactly 2 nullifiers and 2 commitments.' }); return;
    }
    let ext;
    try { ext = BigInt(extAmount); } catch { res.status(400).json({ error: 'Bad extAmount.' }); return; }
    // The relayer ONLY submits withdrawals (funds leave the pool). A deposit
    // (ext_amount ≥ 0) would pull from the relayer's own account — refuse it.
    if (ext >= 0n) { res.status(400).json({ error: 'Relayer only submits withdrawals (extAmount must be negative).' }); return; }
    if (String(fee ?? '0') !== FEE) { res.status(400).json({ error: `Fee must be ${FEE}.` }); return; }
    try { Address.fromString(recipient); } catch { res.status(400).json({ error: 'Bad recipient address.' }); return; }

    const kp = relayerKp();
    const relayer = kp.publicKey();

    // ---- build transact: account = relayer = its own key; fee bound in the proof ----
    const op = new Contract(poolId).call(
      'transact',
      scvBytes(hexToBuf(proof)),
      scvBytes(hexToBuf(root)),
      nativeToScVal(ext, { type: 'i128' }),
      xdr.ScVal.scvVec([scvBytes(hexToBuf(nullifiers[0])), scvBytes(hexToBuf(nullifiers[1]))]),
      xdr.ScVal.scvVec([scvBytes(hexToBuf(commitments[0])), scvBytes(hexToBuf(commitments[1]))]),
      new Address(relayer).toScVal(),    // account (submitter, signer, gas payer)
      new Address(recipient).toScVal(),  // recipient (bound into the proof)
      new Address(relayer).toScVal(),    // relayer / fee recipient (bound)
      nativeToScVal(BigInt(FEE), { type: 'i128' }),
    );

    const acct = await server.getAccount(relayer);
    const tx = new TransactionBuilder(acct, { fee: (Number(BASE_FEE) * 1000).toString(), networkPassphrase: NETWORK })
      .addOperation(op).setTimeout(120).build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) { res.status(400).json({ error: `Simulation failed: ${sim.error}` }); return; }
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(kp);

    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') { res.status(400).json({ error: `Submit rejected: ${JSON.stringify(sent.errorResult)}` }); return; }

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const got = await server.getTransaction(sent.hash);
      if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) { res.status(200).json({ hash: sent.hash }); return; }
      if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
        res.status(400).json({ error: `Failed on-chain (${sent.hash})`, hash: sent.hash }); return;
      }
    }
    res.status(202).json({ hash: sent.hash, pending: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}
