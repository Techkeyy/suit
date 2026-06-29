// SUIT Protocol SDK — Compliance receipts
//
// A compliance receipt is a voluntary disclosure that links a specific
// withdrawal back to a specific deposit. The user generates one when they
// need to (tax reporting, regulatory inquiry). Anyone with the receipt can
// cryptographically verify it against on-chain state.

import {
  rpc, Contract, TransactionBuilder, xdr,
  scValToNative, Keypair, Networks, BASE_FEE,
} from '@stellar/stellar-sdk';
import type { ComplianceReceipt, ReceiptVerification, UTXONote } from './types';
import {
  pubKeyOf, commitHash, signHash, nullHash,
  stroopsToAmount, bytesToBig, be,
} from './crypto';

function computeNullifier(note: UTXONote, leafIndex: number): bigint {
  const priv = BigInt(note.privKey);
  const commitment = BigInt(note.commitment);
  const idx = BigInt(leafIndex);
  const sig = signHash(priv, commitment, idx);
  return nullHash(commitment, idx, sig);
}

function receiptPayload(receipt: ComplianceReceipt): string {
  const { signature: _, ...rest } = receipt;
  return JSON.stringify(rest);
}

export function generateReceipt(
  poolId: string,
  network: string,
  note: UTXONote,
  withdrawAmountStroops: string,
  recipient: string,
  withdrawTxHash: string,
  changeNote?: UTXONote | null,
  decimals = 7,
): ComplianceReceipt {
  const pk = pubKeyOf(BigInt(note.privKey));
  const null0 = computeNullifier(note, note.leafIndex);

  const receipt: ComplianceReceipt = {
    version: 1,
    poolId,
    network,
    deposit: {
      amount: stroopsToAmount(note.amount, decimals),
      pubKey: pk.toString(),
      blinding: note.blinding,
      commitment: note.commitment,
      txHash: note.txHash,
      timestamp: note.ts,
    },
    withdrawal: {
      amount: stroopsToAmount(withdrawAmountStroops, decimals),
      recipient,
      nullifier: null0.toString(),
      txHash: withdrawTxHash,
      timestamp: Date.now(),
    },
  };

  if (changeNote) {
    receipt.change = {
      amount: stroopsToAmount(changeNote.amount, decimals),
      commitment: changeNote.commitment,
    };
  }

  return receipt;
}

export function signReceiptWithKeypair(
  receipt: ComplianceReceipt,
  secretKey: string,
): ComplianceReceipt {
  const kp = Keypair.fromSecret(secretKey);
  const payload = receiptPayload(receipt);
  const sig = kp.sign(Buffer.from(payload));
  return {
    ...receipt,
    signature: {
      signer: kp.publicKey(),
      sig: Buffer.from(sig).toString('hex'),
    },
  };
}

export async function verifyReceipt(
  receipt: ComplianceReceipt,
  rpcUrl?: string,
  startLedger?: number,
  knownCommitments?: Set<string>,
): Promise<ReceiptVerification> {
  if (!receipt?.deposit?.pubKey || !receipt?.deposit?.blinding ||
      !receipt?.deposit?.amount || !receipt?.deposit?.commitment) {
    return { valid: false, commitmentValid: false, commitmentOnChain: false, nullifierBurned: false, signatureValid: null };
  }

  let commitmentValid = false;
  try {
    const pk = BigInt(receipt.deposit.pubKey);
    const bl = BigInt(receipt.deposit.blinding);

    const amtParts = receipt.deposit.amount.split('.');
    const whole = BigInt(amtParts[0] || '0');
    const fracStr = (amtParts[1] || '').padEnd(7, '0').slice(0, 7);
    const amt = whole * 10000000n + BigInt(fracStr);

    const recomputed = commitHash(amt, pk, bl).toString();
    commitmentValid = recomputed === receipt.deposit.commitment;

    if (!commitmentValid) {
      console.error('[SUIT verifyReceipt] commitment mismatch',
        { amt: amt.toString(), pk: pk.toString(), bl: bl.toString(),
          recomputed, expected: receipt.deposit.commitment });
    }
  } catch (e) {
    console.error('[SUIT verifyReceipt] commitment math threw', e);
  }

  const url = rpcUrl ??
    (receipt.network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
  const passphrase = receipt.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

  let commitmentOnChain = false;
  let nullifierBurned = false;
  let signatureValid: boolean | null = null;

  if (knownCommitments) {
    commitmentOnChain = knownCommitments.has(receipt.deposit.commitment);
  }

  try {
    const server = new rpc.Server(url);

    if (!knownCommitments) {
      const filters = [{ type: 'contract' as const, contractIds: [receipt.poolId], topics: [['*']] }];
      const checkEvents = (events: any[]) => {
        for (const e of events) {
          try {
            const data: any = scValToNative(e.value);
            if (data?.out_commitment_0) {
              const c0 = bytesToBig(data.out_commitment_0).toString();
              const c1 = bytesToBig(data.out_commitment_1).toString();
              if (c0 === receipt.deposit.commitment || c1 === receipt.deposit.commitment) {
                commitmentOnChain = true;
              }
            }
          } catch { /* skip */ }
        }
      };

      const cursorLedger = (c?: string): number => {
        if (!c) return Number.MAX_SAFE_INTEGER;
        try { return Number(BigInt(c.split('-')[0]) >> 32n); } catch { return Number.MAX_SAFE_INTEGER; }
      };

      let res: Awaited<ReturnType<rpc.Server['getEvents']>>;
      if (startLedger) {
        try {
          res = await server.getEvents({ startLedger, filters, limit: 200 });
        } catch {
          const latestSeq = (await server.getLatestLedger()).sequence;
          res = await server.getEvents({ startLedger: Math.max(latestSeq - 17000, 1), filters, limit: 200 });
        }
      } else {
        const latestSeq = (await server.getLatestLedger()).sequence;
        res = await server.getEvents({ startLedger: Math.max(latestSeq - 17000, 1), filters, limit: 200 });
      }
      const latest = res.latestLedger;
      checkEvents(res.events);
      let guard = 0;
      while ((res as any).cursor && cursorLedger((res as any).cursor) < latest && guard++ < 1000) {
        res = await server.getEvents({ filters, limit: 200, cursor: (res as any).cursor } as any);
        checkEvents(res.events);
      }
    }

    if (receipt.withdrawal.nullifier) {
      try {
        const nullBig = BigInt(receipt.withdrawal.nullifier);
        const nullBytes = be(nullBig);
        const contract = new Contract(receipt.poolId);
        const account = await server.getAccount(receipt.withdrawal.recipient);
        const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
          .addOperation(contract.call('nullifier_spent', xdr.ScVal.scvBytes(Buffer.from(nullBytes))))
          .setTimeout(30).build();
        const sim = await server.simulateTransaction(tx);
        if (!rpc.Api.isSimulationError(sim) && sim.result) {
          nullifierBurned = scValToNative(sim.result.retval) === true;
        }
      } catch (e) {
        console.error('[SUIT verifyReceipt] nullifier check failed', e);
      }
    }
  } catch (e) {
    console.error('[SUIT verifyReceipt] chain check failed', e);
  }

  if (receipt.signature?.sig) {
    try {
      const kp = Keypair.fromPublicKey(receipt.signature.signer);
      const payload = receiptPayload(receipt);
      const sigBytes = Buffer.from(receipt.signature.sig, 'hex');
      signatureValid = kp.verify(Buffer.from(payload), sigBytes);
    } catch { signatureValid = false; }
  }

  return {
    valid: commitmentValid && commitmentOnChain && nullifierBurned,
    commitmentValid,
    commitmentOnChain,
    nullifierBurned,
    signatureValid,
  };
}
