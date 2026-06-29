// SUIT Protocol SDK — ZK proof helpers (snarkjs / Transaction circuit)

import { randomField, pubKeyOf, commitHash, signHash, nullHash, beRaw, concatBytes } from './crypto';
import { emptyPath } from './tree';

export function dummyInput(depth?: number) {
  const priv = randomField(), blinding = randomField();
  const c = commitHash(0n, pubKeyOf(priv), blinding);
  const sig = signHash(priv, c, 0n);
  return { priv, blinding, nullifier: nullHash(c, 0n, sig), pathElements: emptyPath(depth) };
}

export function encodeProof(proof: any): Uint8Array {
  const g1 = (p: string[]) => concatBytes([beRaw(BigInt(p[0])), beRaw(BigInt(p[1]))]);
  const g2 = (p: string[][]) =>
    concatBytes([beRaw(BigInt(p[0][1])), beRaw(BigInt(p[0][0])), beRaw(BigInt(p[1][1])), beRaw(BigInt(p[1][0]))]);
  return concatBytes([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]);
}
