// SUIT Protocol SDK — Viewing keys + encrypted audit log
//
// A viewing key lets a user prove their shielded activity to a third party
// (auditor, regulator, tax authority) without giving spending access.
// The auditor can verify amounts against on-chain commitments but cannot
// produce valid nullifiers — they can look, not touch.

import type {
  NoteStore, AuditEntry, AuditPackage, AuditReport,
  EncryptedAuditEntry, SuitPoolConfig,
} from './types';
import { toHex, fromHex, commitHash, stroopsToAmount } from './crypto';
import { LeafSyncer } from './sync';

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
  startLedger?: number,
  knownCommitments?: Set<string>,
): Promise<AuditReport> {
  const key = fromHex(viewingKeyHex);
  const entries: (AuditEntry & { onChainVerified: boolean })[] = [];
  let totalIn = 0n;
  let totalOut = 0n;

  const url = rpcUrl ??
    (pkg.network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');

  // Prefer a caller-supplied commitment set (the app injects its LeafSyncer's
  // cached leaves, which include early deposits already pruned from RPC).
  // Fall back to a fresh RPC scan for standalone third-party auditors.
  const onChainCommitments = knownCommitments ??
    await fetchOnChainCommitments(url, pkg.poolId, startLedger);

  for (const enc of pkg.entries) {
    let parsed: AuditEntry;
    try {
      parsed = JSON.parse(await decrypt(enc, key));
    } catch {
      // The viewing key can't decrypt this package — wrong key, not a chain
      // mismatch. Report that distinctly so the UI doesn't blame commitments.
      return {
        valid: false, entries: [], totalShielded: '0', totalWithdrawn: '0',
        netBalance: '0', error: 'decrypt_failed',
      };
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
  const valid = entries.length > 0 && entries.every(e => e.onChainVerified);
  return {
    valid,
    entries,
    totalShielded: stroopsToAmount(totalIn, decimals),
    totalWithdrawn: stroopsToAmount(totalOut, decimals),
    netBalance: stroopsToAmount(totalIn - totalOut, decimals),
    ...(valid ? {} : { error: 'unmatched' as const }),
  };
}

// Reuse the LeafSyncer — it already scans the full RPC retention window
// (parsing the floor from the range error) and paginates correctly via the
// last-event-id cursor fallback. A bespoke scan here would re-introduce the
// narrow-window / dropped-cursor bug that caused UnknownRoot on withdraw.
async function fetchOnChainCommitments(rpcUrl: string, poolId: string, startLedger?: number): Promise<Set<string>> {
  const commitments = new Set<string>();
  try {
    const syncer = new LeafSyncer({ rpcUrl, poolId, startLedger: startLedger ?? 1 });
    const leaves = await syncer.sync(true);
    for (const l of leaves) if (l !== 0n) commitments.add(l.toString());
  } catch { /* network error — partial verification */ }
  return commitments;
}
