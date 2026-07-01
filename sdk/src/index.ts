// SUIT Protocol SDK — public API surface
// Private by default. Auditable by choice.

export { SuitPool } from './pool';
export { KeypairSigner } from './signer';
export { LeafSyncer } from './sync';
export type { SyncConfig } from './sync';

export {
  randomField, pubKeyOf, commitHash, signHash, nullHash,
  amountToStroops, stroopsToAmount, extDataHashField,
  be, beRaw, bytesToBig, concatBytes, toHex, fromHex, scvBytes,
  P, DEFAULT_DECIMALS,
} from './crypto';

export { computeZeros, treeRoot, treePath, emptyPath } from './tree';
export { dummyInput, encodeProof } from './proofs';
export { getRelayerInfo, relaySubmit } from './relayer';

export {
  appendAuditLog, getViewingKeyHex,
  exportAuditPackage, verifyAuditPackage,
} from './viewing-key';

export { generateReceipt, verifyReceipt, signReceiptWithKeypair } from './compliance';

export type {
  SuitPoolConfig, Signer, NoteStore, LeafCache,
  UTXONote, ShieldResult, WithdrawResult,
  RelayerInfo, RelayBundle,
  EncryptedAuditEntry, AuditEntry, AuditPackage, AuditReport,
  ComplianceReceipt, ReceiptVerification,
} from './types';

export const VERSION = '0.3.4';
