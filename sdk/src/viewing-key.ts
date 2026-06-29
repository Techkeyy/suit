// SUIT Protocol SDK — Viewing keys + encrypted audit log
//
// A viewing key lets a user prove their shielded activity to a third party
// (auditor, regulator, tax authority) without giving spending access.
// The auditor can verify amounts against on-chain commitments but cannot
// produce valid nullifiers — they can look, not touch.

import { rpc, scValToNative } from '@stellar/stellar-sdk';
import type {
  NoteStore, AuditEntry, AuditPackage, AuditReport,
  EncryptedAuditEntry, SuitPoolConfig,
} from './types';
import { toHex, fromHex, commitHash, amountToStroops, stroopsToAmount, bytesToBig } from './crypto';

// ── AES-GCM encryption (Web Crypto, zero dependencies) ──

async function encrypt(data: string, key: Uint8Array): Promise<EncryptedAuditEntry> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const ck = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, encoded);
  return { nonce: toHex(iv), ciphertext: toHex(new Uint8Array(ct)) };
}

async function decrypt(entry: EncryptedAuditEntry, key: Uint8Array): Promise<string> {
  const iv = fromHex(entry.nonce);
  const ct = fromHex(entry.ciphertext);
  const ck = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, ct);
  return new TextDecoder().decode(pt);
}

// ── Viewing seed management ──

function getOrCreateSeed(store: NoteStore, poolId: string): Uint8Array {
  let hex = store.getViewingSeed(poolId);
  if (!hex) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    hex = toHex(seed);
    store.setViewingSeed(poolId, hex);
  }
  return fromHex(hex);
}

// ── Audit log ──

export async function appendAuditLog(
  store: NoteStore,
  poolId: string,
  entry: AuditEntry,
): Promise<void> {
  const seed = getOrCreateSeed(store, poolId);
  const encrypted = await encrypt(JSON.stringify(entry), seed);
  store.appendAuditEntry(poolId, encrypted);
}

export function getViewingKeyHex(store: NoteStore, poolId: string): string {
  const seed = getOrCreateSeed(store, poolId);
  return toHex(seed);
}

// ── Export ──

export function exportAuditPackage(config: SuitPoolConfig): AuditPackage {
  return {
    version: 1,
    poolId: config.poolId,
    network: config.network,
    tokenId: config.tokenId,
    verifierId: config.verifierId,
    entries: config.noteStore.getAuditLog(config.poolId),
  };
}

// ── Verify (static — anyone with the viewing key can run this) ──

export async function verifyAuditPackage(
  pkg: AuditPackage,
  viewingKeyHex: string,
  rpcUrl?: string,
): Promise<AuditReport> {
  const key = fromHex(viewingKeyHex);
  const entries: (AuditEntry & { onChainVerified: boolean })[] = [];
  let totalIn = 0n;
  let totalOut = 0n;

  const url = rpcUrl ??
    (pkg.network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');

  const onChainCommitments = await fetchOnChainCommitments(url, pkg.poolId);

  for (const enc of pkg.entries) {
    let parsed: AuditEntry;
    try {
      parsed = JSON.parse(await decrypt(enc, key));
    } catch {
      return { valid: false, entries: [], totalShielded: '0', totalWithdrawn: '0', netBalance: '0' };
    }

    const amt = BigInt(parsed.amount);
    const pk = BigInt(parsed.pubKey);
    const bl = BigInt(parsed.blinding);
    const recomputed = commitHash(amt, pk, bl).toString();
    const onChainVerified = recomputed === parsed.commitment &&
      onChainCommitments.has(parsed.commitment);

    entries.push({ ...parsed, onChainVerified });

    if (parsed.type === 'shield') totalIn += amt;
    else totalOut += amt;
  }

  const decimals = 7;
  return {
    valid: entries.every(e => e.onChainVerified),
    entries,
    totalShielded: stroopsToAmount(totalIn, decimals),
    totalWithdrawn: stroopsToAmount(totalOut, decimals),
    netBalance: stroopsToAmount(totalIn - totalOut, decimals),
  };
}

async function fetchOnChainCommitments(rpcUrl: string, poolId: string): Promise<Set<string>> {
  const server = new rpc.Server(rpcUrl);
  const commitments = new Set<string>();

  let start: number;
  try {
    const latest = (await server.getLatestLedger()).sequence;
    start = Math.max(latest - 16000, 1);
  } catch { return commitments; }

  const filters = [{ type: 'contract' as const, contractIds: [poolId], topics: [['*']] }];

  try {
    let res = await server.getEvents({ startLedger: start, filters, limit: 200 });
    for (const e of res.events) {
      try {
        const data: any = scValToNative(e.value);
        if (data?.out_commitment_0) {
          commitments.add(bytesToBig(data.out_commitment_0).toString());
          commitments.add(bytesToBig(data.out_commitment_1).toString());
        }
      } catch { /* skip */ }
    }
    while (res.events.length === 200 && (res as any).cursor) {
      res = await server.getEvents({ filters, limit: 200, cursor: (res as any).cursor } as any);
      for (const e of res.events) {
        try {
          const data: any = scValToNative(e.value);
          if (data?.out_commitment_0) {
            commitments.add(bytesToBig(data.out_commitment_0).toString());
            commitments.add(bytesToBig(data.out_commitment_1).toString());
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* network error — partial verification */ }

  return commitments;
}
