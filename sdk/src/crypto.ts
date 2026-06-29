// SUIT Protocol SDK — Field arithmetic, Poseidon wrappers, byte helpers

import { poseidon1, poseidon2, poseidon3 } from 'poseidon-lite';
import { keccak256 } from 'js-sha3';
import { Address, xdr } from '@stellar/stellar-sdk';

export const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEFAULT_DECIMALS = 7;

export function randomField(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v % P;
}

export function be(v: bigint, n = 32): Uint8Array {
  let x = ((v % P) + P) % P;
  const o = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o;
}

export function beRaw(v: bigint, n = 32): Uint8Array {
  let x = v;
  const o = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o;
}

export function bytesToBig(b: Uint8Array | number[] | Buffer): bigint {
  let v = 0n;
  for (const x of b as Uint8Array) v = (v << 8n) | BigInt(x);
  return v;
}

export function concatBytes(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, x) => s + x.length, 0);
  const o = new Uint8Array(len);
  let p = 0;
  for (const x of arrs) { o.set(x, p); p += x.length; }
  return o;
}

export const toHex = (b: Uint8Array) =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

export const fromHex = (h: string) =>
  new Uint8Array((h.match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));

// ── Poseidon (BN254, matches circomlib exactly) ──

export const pubKeyOf = (priv: bigint) => poseidon1([priv]);
export const commitHash = (amount: bigint, pk: bigint, blinding: bigint) =>
  poseidon3([amount, pk, blinding]);
export const signHash = (priv: bigint, commitment: bigint, idx: bigint) =>
  poseidon3([priv, commitment, idx]);
export const nullHash = (commitment: bigint, idx: bigint, sig: bigint) =>
  poseidon3([commitment, idx, sig]);

export { poseidon2 };

// ── Amount conversion ──

export function amountToStroops(amount: string, decimals = DEFAULT_DECIMALS): bigint {
  const unit = 10n ** BigInt(decimals);
  const parts = amount.split('.');
  const whole = BigInt(parts[0] || '0');
  const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
  return whole * unit + BigInt(frac);
}

export function stroopsToAmount(stroops: bigint | string, decimals = DEFAULT_DECIMALS): string {
  const s = BigInt(stroops);
  const unit = 10n ** BigInt(decimals);
  const whole = s / unit;
  const frac = s % unit;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

// ── extDataHash — binds (recipient, relayer, fee) into the proof ──

export function extDataHashField(recipient: string, relayer: string, fee: bigint): bigint {
  const rb = new Uint8Array(new Address(recipient).toScVal().toXDR());
  const lb = new Uint8Array(new Address(relayer).toScVal().toXDR());
  const fb = beRaw(fee, 16);
  const d = new Uint8Array(keccak256.arrayBuffer(concatBytes([rb, lb, fb])));
  return bytesToBig(d.slice(1));
}

// ── Soroban helpers ──

export const scvBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b));
