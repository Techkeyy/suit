// SUIT — browser adapter (thin layer over @suit-protocol/sdk)
//
// Plugs Freighter wallet + localStorage into the SDK's abstract interfaces.
// All ZK / pool / tree logic lives in the SDK; this file handles:
//   - FreighterSigner (wallet-specific signing + signature repair)
//   - LocalStorageNoteStore (browser persistence)
//   - LocalStorageLeafCache (tree leaf persistence)
//   - Token switching (XLM / USDC)
//   - Faucets and balance helpers

import {
  rpc,
  Horizon,
  Asset,
  Operation,
  TransactionBuilder,
  Keypair,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { isConnected, requestAccess, getAddress, signTransaction } from '@stellar/freighter-api';
import {
  SuitPool, stroopsToAmount, amountToStroops,
  getViewingKeyHex as _getViewingKeyHex,
  exportAuditPackage as _exportAuditPackage,
  verifyAuditPackage as _verifyAuditPackage,
  generateReceipt as _generateReceipt,
  verifyReceipt as _verifyReceipt,
  type Signer, type NoteStore, type LeafCache, type UTXONote,
  type EncryptedAuditEntry, type SuitPoolConfig,
} from '@suit-protocol/sdk';

// ── Network config (shared by every token pool) ──

export const CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  network: Networks.TESTNET,
  verifierId: 'CDEZRSL6WXBEJZ45WVFDI6DIHJEZ6UEWY3CUJIQPLCQIVUMLXXVKON2T',
  depth: 16,
  decimals: 7,
  explorer: 'https://stellar.expert/explorer/testnet',
  relayerUrl: (import.meta as any).env?.VITE_RELAYER_URL || '/api/relay',
};

// ── Token definitions ──

export type TokenSym = 'XLM' | 'USDC';
export interface TokenInfo {
  sym: TokenSym;
  label: string;
  poolId: string;
  tokenId: string;
  startLedger: number;
  issuer?: string;
  assetCode?: string;
}
export const TOKENS: Record<TokenSym, TokenInfo> = {
  XLM: {
    sym: 'XLM', label: 'XLM',
    poolId: 'CDGGJTTWSOGHKO6GCZTZQUIO4U2Y5PUQOSAWESGUUC74QUXDHGIPPX6X',
    tokenId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    startLedger: 3239820,
  },
  USDC: {
    sym: 'USDC', label: 'USDC',
    poolId: 'CARK2WXVBDREA3ARTCGCRHHDXDG4YXSZSU52QIL6BPVPRBV6TTJXD4GS',
    tokenId: 'CDCFQVDHKVOMLF237VYGKFTBYWBUGC73IU233CDQ7SPNFKGXWWALMASU',
    startLedger: 3239960,
    issuer: 'GDA3FKYJLOOOUI7UF6JHVMZPTKHFJT7BWZWIMACU7EDE75ALI5IVJTWL',
    assetCode: 'USDC',
  },
};

let activeSym: TokenSym = 'XLM';
try { const s = localStorage.getItem('suit_token'); if (s === 'XLM' || s === 'USDC') activeSym = s; } catch { /* ssr */ }

export function getActiveToken(): TokenInfo { return TOKENS[activeSym]; }
export function getActiveSym(): TokenSym { return activeSym; }
export function setActiveToken(s: TokenSym) {
  activeSym = s;
  try { localStorage.setItem('suit_token', s); } catch { /* ignore */ }
  poolInstances.clear();
}

// ── FreighterSigner (implements SDK's Signer interface) ──

class FreighterSigner implements Signer {
  async getAddress(): Promise<string> {
    const a = await getAddress();
    return (a as any).address || '';
  }

  async signTransaction(preparedXdr: string, networkPassphrase: string): Promise<string> {
    const address = await this.getAddress();

    const signed = await signTransaction(preparedXdr, { networkPassphrase, address });
    if ((signed as any).error) {
      const e = (signed as any).error;
      throw new Error(typeof e === 'string' ? e : (e.message || JSON.stringify(e)));
    }
    const xdrStr = (signed as any).signedTxXdr;
    if (!xdrStr) throw new Error('Wallet returned no signed transaction.');

    // Signature repair: Freighter may re-encode the envelope and sign a different
    // hash than the one we sent. Detect this and reattach the valid signature to
    // the original transaction.
    const prepared = TransactionBuilder.fromXDR(preparedXdr, networkPassphrase) as any;
    const preparedHash = prepared.hash();
    const returned = TransactionBuilder.fromXDR(xdrStr, networkPassphrase) as any;
    const returnedHash = returned.hash();
    const sigs = returned.signatures || [];

    if (sigs.length === 0) {
      throw new Error('Freighter returned an unsigned transaction. Unlock it, make sure it is set to Testnet, and approve the signing prompt.');
    }

    const srcKp = Keypair.fromPublicKey(address);
    for (const ds of sigs) {
      const sigBuf = ds.signature();
      if (srcKp.verify(returnedHash, sigBuf)) return xdrStr;
      if (srcKp.verify(preparedHash, sigBuf)) {
        prepared.signatures.push(ds);
        return prepared.toXDR();
      }
    }

    // Diagnose: wrong account, wrong network, or signing divergence
    const srcHint = Keypair.fromPublicKey(address).rawPublicKey().slice(-4).toString('hex').toUpperCase();
    const sigHints = sigs.map((ds: any) => Buffer.from(ds.hint()).toString('hex').toUpperCase());
    const hintMatches = sigHints.includes(srcHint);

    let signedForNetwork = '';
    for (const [label, pass] of [['Mainnet (Public)', Networks.PUBLIC], ['Futurenet', 'Test SDF Future Network ; October 2022']] as [string, string][]) {
      const h = (TransactionBuilder.fromXDR(returned.toXDR(), pass) as any).hash();
      if (sigs.some((ds: any) => srcKp.verify(h, ds.signature()))) { signedForNetwork = label; break; }
    }

    const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
    if (!hintMatches) {
      throw new Error(
        `Freighter signed with a different account (key …${sigHints[0] || '????'}) than this transaction's source (…${srcHint}). ` +
        `Open Freighter, switch the active account to ${short}, and retry.`,
      );
    }
    if (signedForNetwork) {
      throw new Error(
        `Freighter signed this for ${signedForNetwork}, but the pool is on Testnet. ` +
        `Open Freighter → network dropdown → select "Test Net", then retry.`,
      );
    }
    throw new Error(
      `Freighter's signature matches your account but no known network for this exact transaction ` +
      `(hash ${preparedHash.toString('hex').slice(0, 12)}). Update Freighter and retry.`,
    );
  }
}

// ── LocalStorageNoteStore (implements SDK's NoteStore interface) ──

class LocalStorageNoteStore implements NoteStore {
  private prefix(poolId: string) { return poolId.slice(0, 8); }

  getNotes(poolId: string): UTXONote[] {
    try { return JSON.parse(localStorage.getItem(`suit_notes_${this.prefix(poolId)}`) || '[]'); }
    catch { return []; }
  }
  saveNotes(poolId: string, notes: UTXONote[]) {
    localStorage.setItem(`suit_notes_${this.prefix(poolId)}`, JSON.stringify(notes));
  }
  getViewingSeed(poolId: string): string | null {
    return localStorage.getItem(`suit_vk_${this.prefix(poolId)}`);
  }
  setViewingSeed(poolId: string, seed: string) {
    localStorage.setItem(`suit_vk_${this.prefix(poolId)}`, seed);
  }
  getAuditLog(poolId: string): EncryptedAuditEntry[] {
    try { return JSON.parse(localStorage.getItem(`suit_audit_${this.prefix(poolId)}`) || '[]'); }
    catch { return []; }
  }
  appendAuditEntry(poolId: string, entry: EncryptedAuditEntry) {
    const log = this.getAuditLog(poolId);
    log.push(entry);
    localStorage.setItem(`suit_audit_${this.prefix(poolId)}`, JSON.stringify(log));
  }
}

// ── LocalStorageLeafCache (implements SDK's LeafCache interface) ──

class LocalStorageLeafCache implements LeafCache {
  load(poolId: string): Map<number, string> {
    const m = new Map<number, string>();
    try {
      const raw = JSON.parse(localStorage.getItem(`suit_leafcache_${poolId.slice(0, 8)}`) || '{}');
      for (const k of Object.keys(raw)) m.set(Number(k), raw[k]);
    } catch { /* ignore */ }
    return m;
  }
  save(poolId: string, data: Map<number, string>) {
    const obj: Record<string, string> = {};
    for (const [k, v] of data) obj[k] = v;
    localStorage.setItem(`suit_leafcache_${poolId.slice(0, 8)}`, JSON.stringify(obj));
  }
}

// ── Pool instance management ──

const signer = new FreighterSigner();
const noteStore = new LocalStorageNoteStore();
const leafCache = new LocalStorageLeafCache();
const poolInstances = new Map<string, SuitPool>();

function getPool(tok?: TokenInfo): SuitPool {
  const t = tok || getActiveToken();
  let pool = poolInstances.get(t.poolId);
  if (!pool) {
    pool = new SuitPool({
      network: 'testnet',
      networkPassphrase: CONFIG.network,
      rpcUrl: CONFIG.rpcUrl,
      poolId: t.poolId,
      tokenId: t.tokenId,
      verifierId: CONFIG.verifierId,
      startLedger: t.startLedger,
      decimals: CONFIG.decimals,
      depth: CONFIG.depth,
      signer,
      noteStore,
      leafCache,
      circuitWasmPath: '/circuit-tx/Transaction.wasm',
      circuitZkeyPath: '/circuit-tx/Transaction_final.zkey',
      relayerUrl: CONFIG.relayerUrl,
      explorerUrl: CONFIG.explorer,
    });
    poolInstances.set(t.poolId, pool);
  }
  return pool;
}

// ── Public API (matches what UI components import) ──

export { stroopsToAmount };
export function xlmToStroops(amt: string): bigint {
  return amountToStroops(amt, CONFIG.decimals);
}
export function stroopsToXlm(stroops: bigint | string): string {
  return stroopsToAmount(stroops, CONFIG.decimals);
}

export type { UTXONote };
export function getNotes(): UTXONote[] {
  return getPool().getNotes();
}

export async function syncLeaves(force = false) {
  return getPool().syncLeaves(force);
}

export async function getPoolCount(): Promise<number> {
  return getPool().getCount();
}

export async function getRelayerInfo() {
  return getPool().getRelayerInfo();
}

export async function shield(
  address: string,
  amountXLM: string,
  onStep?: (m: string) => void,
): Promise<{ txHash: string; note: UTXONote }> {
  address = (await getWalletAddress()) || address;
  return getPool().shield(amountXLM, onStep);
}

export async function withdraw(
  address: string,
  note: UTXONote,
  amountXLM: string,
  recipient: string,
  onStep?: (m: string) => void,
): Promise<{ txHash: string; changeNote: UTXONote | null }> {
  address = (await getWalletAddress()) || address;
  return getPool().withdraw(note, amountXLM, recipient, onStep);
}

// ── Viewing keys + compliance (delegated to SDK, store/config injected here) ──

import type {
  AuditPackage, AuditReport, ComplianceReceipt, ReceiptVerification,
} from '@suit-protocol/sdk';
export type { AuditPackage, AuditReport, ComplianceReceipt, ReceiptVerification };

/** The viewing key (hex) for the active pool — share it to grant read-only audit access. */
export function getViewingKey(): string {
  return _getViewingKeyHex(noteStore, getActiveToken().poolId);
}

/** Encrypted audit package for the active pool — hand to an auditor alongside the viewing key. */
export function exportAuditPackage(): AuditPackage {
  return _exportAuditPackage(getPool().config);
}

/** Decrypt + verify an audit package against the chain. Static — anyone with the key can run it. */
export function verifyAuditPackage(pkg: AuditPackage, viewingKeyHex: string): Promise<AuditReport> {
  return _verifyAuditPackage(pkg, viewingKeyHex, CONFIG.rpcUrl, getActiveToken().startLedger);
}

/** Generate a compliance receipt linking a spent note to its withdrawal. */
export function generateReceipt(note: UTXONote): ComplianceReceipt {
  const tok = getActiveToken();
  if (!note.spent || !note.withdrawTxHash || !note.withdrawAmount || !note.recipient) {
    throw new Error('Receipts can only be generated for spent notes (after a withdrawal).');
  }
  const changeNote = note.changeCommitment
    ? getPool().getNotes().find(n => n.commitment === note.changeCommitment) || null
    : null;
  return _generateReceipt(
    tok.poolId, 'testnet', note,
    note.withdrawAmount, note.recipient, note.withdrawTxHash,
    changeNote, CONFIG.decimals,
  );
}

/** Verify a compliance receipt against on-chain state. Static — anyone can run it. */
export async function verifyReceipt(receipt: ComplianceReceipt): Promise<ReceiptVerification> {
  const pool = getPool();
  const leaves = await pool.syncLeaves();
  const knownCommitments = new Set(leaves.map(l => l.toString()));
  return _verifyReceipt(receipt, CONFIG.rpcUrl, getActiveToken().startLedger, knownCommitments);
}

export function getPoolConfig(): SuitPoolConfig {
  return getPool().config;
}

// ── Wallet helpers (Freighter-specific, stays in app) ──

export async function connectWallet(): Promise<string> {
  const c = await isConnected();
  if (!(c as any).isConnected) throw new Error('Freighter not detected.');
  const a = await requestAccess();
  if ((a as any).error) throw new Error((a as any).error);
  return (a as any).address as string;
}

export async function getWalletAddress(): Promise<string | null> {
  try {
    const c = await isConnected();
    if (!(c as any).isConnected) return null;
    const a = await getAddress();
    return (a as any).address || null;
  } catch { return null; }
}

export async function getXlmBalance(address: string): Promise<string> {
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
  if (!res.ok) {
    if (res.status === 404) return '0';
    throw new Error(`Balance lookup failed (${res.status})`);
  }
  const data = await res.json();
  const native = (data.balances || []).find((b: any) => b.asset_type === 'native');
  return native ? native.balance : '0';
}

export async function getWalletTokenBalance(address: string): Promise<string> {
  const tok = getActiveToken();
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
  if (!res.ok) return '0';
  const data = await res.json();
  if (tok.sym === 'XLM') {
    const n = (data.balances || []).find((b: any) => b.asset_type === 'native');
    return n ? n.balance : '0';
  }
  const t = (data.balances || []).find((b: any) => b.asset_code === tok.assetCode && b.asset_issuer === tok.issuer);
  return t ? t.balance : '0';
}

// ── Faucets (app-specific, not protocol) ──

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

export async function enableAndFundUSDC(address: string, onStep?: (m: string) => void): Promise<void> {
  const tok = TOKENS.USDC;
  if (!tok.issuer || !tok.assetCode) throw new Error('USDC not configured.');
  address = (await getWalletAddress()) || address;

  const horizon = new Horizon.Server(HORIZON_URL);
  const asset = new Asset(tok.assetCode, tok.issuer);

  const acct = await horizon.loadAccount(address);
  const hasTrust = (acct.balances || []).some((b: any) => b.asset_code === tok.assetCode && b.asset_issuer === tok.issuer);
  if (!hasTrust) {
    onStep?.('Approve the USDC trustline in Freighter…');
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: CONFIG.network })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(120).build();
    const signed = await signTransaction(tx.toXDR(), { networkPassphrase: CONFIG.network, address });
    if ((signed as any).error) throw new Error((signed as any).error.message || String((signed as any).error));
    const xdrStr = (signed as any).signedTxXdr;
    if (!xdrStr) throw new Error('Trustline was not signed.');
    onStep?.('Adding trustline…');
    await horizon.submitTransaction(TransactionBuilder.fromXDR(xdrStr, CONFIG.network) as any);
  }

  onStep?.('Requesting test USDC from the faucet…');
  const r = await fetch('/api/faucet', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }),
  });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || j.error) throw new Error(j.error || `Faucet error (${r.status})`);
  onStep?.(`Received ${j.amount || ''} test USDC.`);
}

export async function fundTestnetXLM(address: string, onStep?: (m: string) => void): Promise<void> {
  onStep?.('Requesting testnet XLM from Friendbot…');
  const r = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({} as any));
    const msg = j?.detail || j?.message || `Friendbot error (${r.status})`;
    if (/already exists/i.test(msg)) {
      onStep?.('Account already funded — you should have testnet XLM.');
      return;
    }
    throw new Error(msg);
  }
  onStep?.('Received 10,000 testnet XLM.');
}
