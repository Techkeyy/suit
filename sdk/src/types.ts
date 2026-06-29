// SUIT Protocol SDK — Type definitions

// ── Interfaces ──

export interface SuitPoolConfig {
  network: 'testnet' | 'mainnet';
  networkPassphrase?: string;
  rpcUrl?: string;
  poolId: string;
  tokenId: string;
  verifierId: string;
  startLedger: number;
  decimals?: number;
  depth?: number;
  signer: Signer;
  noteStore: NoteStore;
  leafCache?: LeafCache;
  circuitWasmPath: string;
  circuitZkeyPath: string;
  relayerUrl?: string;
  explorerUrl?: string;
}

export interface Signer {
  getAddress(): Promise<string>;
  signTransaction(preparedXdr: string, networkPassphrase: string): Promise<string>;
}

export interface NoteStore {
  getNotes(poolId: string): UTXONote[];
  saveNotes(poolId: string, notes: UTXONote[]): void;
  getViewingSeed(poolId: string): string | null;
  setViewingSeed(poolId: string, seed: string): void;
  getAuditLog(poolId: string): EncryptedAuditEntry[];
  appendAuditEntry(poolId: string, entry: EncryptedAuditEntry): void;
}

export interface LeafCache {
  load(poolId: string): Map<number, string>;
  save(poolId: string, data: Map<number, string>): void;
}

// ── Data types ──

export interface UTXONote {
  amount: string;
  privKey: string;
  blinding: string;
  commitment: string;
  leafIndex: number;
  spent: boolean;
  txHash: string;
  ts: number;
  // populated when the note is spent — enables compliance receipts
  withdrawTxHash?: string;
  withdrawAmount?: string;     // stroops sent to recipient
  recipient?: string;
  changeCommitment?: string;   // commitment of the change note, if any
}

export interface ShieldResult {
  txHash: string;
  note: UTXONote;
}

export interface WithdrawResult {
  txHash: string;
  changeNote: UTXONote | null;
}

export interface RelayerInfo {
  relayer: string;
  fee: string;
}

export interface RelayBundle {
  poolId: string;
  proof: string;
  root: string;
  extAmount: string;
  nullifiers: string[];
  commitments: string[];
  recipient: string;
  fee: string;
}

// ── Viewing key / audit ──

export interface EncryptedAuditEntry {
  nonce: string;
  ciphertext: string;
}

export interface AuditEntry {
  type: 'shield' | 'withdraw';
  amount: string;
  pubKey: string;
  blinding: string;
  commitment: string;
  leafIndex: number;
  txHash: string;
  timestamp: number;
  recipient?: string;
}

export interface AuditPackage {
  version: 1;
  poolId: string;
  network: string;
  tokenId: string;
  verifierId: string;
  entries: EncryptedAuditEntry[];
}

export interface AuditReport {
  valid: boolean;
  entries: (AuditEntry & { onChainVerified: boolean })[];
  totalShielded: string;
  totalWithdrawn: string;
  netBalance: string;
}

// ── Compliance receipts ──

export interface ComplianceReceipt {
  version: 1;
  poolId: string;
  network: string;
  deposit: {
    amount: string;
    pubKey: string;
    blinding: string;
    commitment: string;
    txHash: string;
    timestamp: number;
  };
  withdrawal: {
    amount: string;
    recipient: string;
    nullifier: string;
    txHash: string;
    timestamp: number;
  };
  change?: {
    amount: string;
    commitment: string;
  };
  signature?: {
    signer: string;
    sig: string;
  };
}

export interface ReceiptVerification {
  valid: boolean;
  commitmentValid: boolean;
  commitmentOnChain: boolean;
  nullifierBurned: boolean;
  signatureValid: boolean | null;
}
