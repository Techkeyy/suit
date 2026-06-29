// SUIT Protocol SDK — Compliance receipts
//
// A compliance receipt is a voluntary disclosure that links a specific
// withdrawal back to a specific deposit. The user generates one when they
// need to (tax reporting, regulatory inquiry). Anyone with the receipt can
// cryptographically verify it against on-chain state.

import { rpc, scValToNative } from '@stellar/stellar-sdk';
import type { ComplianceReceipt, ReceiptVerification, UTXONote } from './types';
import { pubKeyOf, commitHash, stroopsToAmount, bytesToBig } from './crypto';

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

export async function verifyReceipt(
  receipt: ComplianceReceipt,
  rpcUrl?: string,
): Promise<ReceiptVerification> {
  const pk = BigInt(receipt.deposit.pubKey);
  const bl = BigInt(receipt.deposit.blinding);

  // Re-parse the human-readable amount back to stroops to recompute the commitment.
  // stroopsToAmount produces "X.Y" from stroops; we reverse it here.
  const amtParts = receipt.deposit.amount.split('.');
  const whole = BigInt(amtParts[0] || '0');
  const fracStr = (amtParts[1] || '').padEnd(7, '0').slice(0, 7);
  const amt = whole * 10000000n + BigInt(fracStr);

  const recomputed = commitHash(amt, pk, bl).toString();
  const commitmentValid = recomputed === receipt.deposit.commitment;

  const url = rpcUrl ??
    (receipt.network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');

  let commitmentOnChain = false;
  let nullifierBurned = false;

  try {
    const server = new rpc.Server(url);
    const latest = (await server.getLatestLedger()).sequence;
    const start = Math.max(latest - 16000, 1);
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

    let res = await server.getEvents({ startLedger: start, filters, limit: 200 });
    checkEvents(res.events);
    while (res.events.length === 200 && (res as any).cursor) {
      res = await server.getEvents({ filters, limit: 200, cursor: (res as any).cursor } as any);
      checkEvents(res.events);
    }
  } catch { /* network error */ }

  return {
    valid: commitmentValid && commitmentOnChain,
    commitmentValid,
    commitmentOnChain,
    nullifierBurned,
  };
}
