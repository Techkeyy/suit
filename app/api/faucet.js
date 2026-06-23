// SUIT — test-USDC faucet (Vercel serverless function).
//
// Sends the demo asset (USDC issued by our testnet issuer) to a user who has
// already added the trustline, so they can try the shielded USDC pool. Testnet
// only; the asset is clearly a test token. The trustline itself must be added by
// the user (only the account owner can authorize a trustline) — the app does that
// step in Freighter, then calls this to receive funds.
//
// POST /api/faucet  { address }  ⇒ { hash } | { error }
// Requires env SUIT_USDC_ISSUER_SECRET (the issuer's secret seed).
import { Horizon, Asset, Operation, TransactionBuilder, Keypair, Networks, BASE_FEE } from '@stellar/stellar-sdk';

const HORIZON = 'https://horizon-testnet.stellar.org';
const ASSET_CODE = 'USDC';
const AMOUNT = '1000'; // test units per request

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const secret = process.env.SUIT_USDC_ISSUER_SECRET;
    if (!secret) { res.status(500).json({ error: 'Faucet not configured (missing SUIT_USDC_ISSUER_SECRET).' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const address = body.address;
    if (!address || typeof address !== 'string' || !address.startsWith('G')) {
      res.status(400).json({ error: 'Provide a Stellar account (G…) address.' }); return;
    }

    const issuer = Keypair.fromSecret(secret);
    const horizon = new Horizon.Server(HORIZON);
    const asset = new Asset(ASSET_CODE, issuer.publicKey());

    const issuerAcct = await horizon.loadAccount(issuer.publicKey());
    const tx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: address, asset, amount: AMOUNT }))
      .setTimeout(60).build();
    tx.sign(issuer);

    try {
      const r = await horizon.submitTransaction(tx);
      res.status(200).json({ hash: r.hash, amount: AMOUNT, code: ASSET_CODE });
    } catch (e) {
      const codes = e?.response?.data?.extras?.result_codes;
      if (codes && JSON.stringify(codes).includes('op_no_trust')) {
        res.status(400).json({ error: 'Add the USDC trustline first, then request funds.' });
      } else {
        res.status(400).json({ error: `Faucet payment failed: ${JSON.stringify(codes || e.message)}` });
      }
    }
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}
