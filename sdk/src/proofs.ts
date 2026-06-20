// SUIT Protocol SDK — Proof generation
//
// Real Circom/Groth16 range-proof generation over BLS12-381 via snarkjs. The
// proof this produces is the exact one the deployed Soroban verifier checks
// on-chain.
//
// NOTE ON ENCODING: the byte encoding consumed by the contracts (G1 = 96
// bytes, G2 = 192 bytes, arkworks `serialize_uncompressed`) is produced by the
// Rust tool `tools/circom_to_soroban_hex`, which is the single source of truth
// and is matched 1:1 by the contract parsers. Generate the proof here, then
// run that tool to get the `proof.hex` / `public.hex` passed to `deposit`.

import {
  PaymentProofInputs,
  RangeProofResult,
} from './types';

/**
 * Generate a BLS12-381 Groth16 range proof: proves
 * `min_amount <= amount <= max_amount` and `commitment == amount + secret`,
 * revealing only `min_amount`, `max_amount`, and `commitment`.
 */
export async function generateRangeProof(
  inputs: PaymentProofInputs,
  wasmPath: string,
  zkeyPath: string
): Promise<RangeProofResult> {
  const snarkjs = await import('snarkjs');
  const { amount, secret, policy } = inputs;

  // Commitment as proven by the circuit. (A production deployment should use a
  // hiding commitment, e.g. Pedersen; the circuit's `commitment` signal would
  // change accordingly — see README roadmap.)
  const commitment = amount + secret;

  const circuitInputs = {
    amount: amount.toString(),
    secret: secret.toString(),
    min_amount: policy.minAmount.toString(),
    max_amount: policy.maxAmount.toString(),
    commitment: commitment.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    wasmPath,
    zkeyPath
  );

  return { proof, publicSignals, commitment };
}

/** Verify a proof locally (sanity check before submitting on-chain). */
export async function verifyRangeProofLocal(
  verificationKey: unknown,
  publicSignals: string[],
  proof: unknown
): Promise<boolean> {
  const snarkjs = await import('snarkjs');
  return snarkjs.groth16.verify(verificationKey as any, publicSignals, proof as any);
}
