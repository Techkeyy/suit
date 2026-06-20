// SUIT Protocol SDK — entry point
// Private by default. Auditable by choice.

export { generateRangeProof, verifyRangeProofLocal } from './proofs';
export { deposit, withdraw, verifyOnChain } from './pool';
export * from './types';

export const VERSION = '0.2.0';
export const SUIT_PROTOCOL = 'SUIT — Shielded Universal Payment Protocol on Stellar';
