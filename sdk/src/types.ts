// SUIT Protocol SDK — Type definitions

export interface SuitConfig {
  /** Stellar network */
  network: 'testnet' | 'mainnet' | 'local';
  /** RPC URL override (optional) */
  rpcUrl?: string;
  /** Deployed pool contract ID */
  poolContractId: string;
  /** Deployed Groth16 verifier contract ID */
  groth16VerifierId: string;
}

export interface PaymentPolicy {
  /** Minimum amount (base units) */
  minAmount: bigint;
  /** Maximum amount (base units) */
  maxAmount: bigint;
  /** Policy ID */
  policyId: number;
}

export interface PaymentProofInputs {
  /** Actual amount (private — never leaves the client) */
  amount: bigint;
  /** Blinding factor (private) */
  secret: bigint;
  /** Policy bounds to prove against */
  policy: PaymentPolicy;
}

export interface RangeProofResult {
  /** snarkjs proof object (encode with circom_to_soroban_hex before submitting) */
  proof: unknown;
  /** Public signals [min_amount, max_amount, commitment] */
  publicSignals: string[];
  /** Commitment value */
  commitment: bigint;
}

export interface DepositParams {
  /** Depositor Stellar secret key */
  senderSecretKey: string;
  /** 32-byte commitment, hex */
  commitmentHex: string;
  /** Groth16 proof bytes, hex (from circom_to_soroban_hex) */
  proofHex: string;
  /** Public signal bytes, hex (from circom_to_soroban_hex) */
  publicHex: string;
}

export interface WithdrawParams {
  /** Source secret key paying the fee (need not be the recipient) */
  senderSecretKey: string;
  /** Recipient Stellar address (G...) */
  recipient: string;
  /** 32-byte nullifier, hex */
  nullifierHex: string;
  /** 32-byte leaf/commitment, hex */
  leafHex: string;
  /** Merkle path siblings, hex (length = tree depth) */
  pathElements: string[];
  /** Merkle path direction bits (0 = left, 1 = right) */
  pathIndices: number[];
  /** Known root, hex */
  rootHex: string;
}

export interface TxResult {
  txHash: string;
}
