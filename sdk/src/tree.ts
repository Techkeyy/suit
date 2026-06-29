// SUIT Protocol SDK — Depth-16 Poseidon Merkle tree (matches on-chain pool)

import { poseidon2 } from 'poseidon-lite';

const DEFAULT_DEPTH = 16;

export function computeZeros(depth: number): bigint[] {
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) zeros.push(poseidon2([zeros[i - 1], zeros[i - 1]]));
  return zeros;
}

export function treeRoot(leaves: bigint[], depth = DEFAULT_DEPTH): bigint {
  const zeros = computeZeros(depth);
  if (leaves.length === 0) return zeros[depth];
  let layer = leaves.slice();
  for (let d = 0; d < depth; d++) {
    const next: bigint[] = [];
    const len = Math.max(layer.length, 1);
    for (let i = 0; i < len; i += 2) {
      const l = i < layer.length ? layer[i] : zeros[d];
      const r = i + 1 < layer.length ? layer[i + 1] : zeros[d];
      next.push(poseidon2([l, r]));
    }
    layer = next;
  }
  return layer[0];
}

export function treePath(index: number, leaves: bigint[], depth = DEFAULT_DEPTH): bigint[] {
  const zeros = computeZeros(depth);
  const path: bigint[] = [];
  let layer = leaves.slice();
  let idx = index;
  for (let d = 0; d < depth; d++) {
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    path.push(sib >= 0 && sib < layer.length ? layer[sib] : zeros[d]);
    const next: bigint[] = [];
    const len = Math.max(layer.length, 1);
    for (let i = 0; i < len; i += 2) {
      const l = i < layer.length ? layer[i] : zeros[d];
      const r = i + 1 < layer.length ? layer[i + 1] : zeros[d];
      next.push(poseidon2([l, r]));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return path;
}

export function emptyPath(depth = DEFAULT_DEPTH): string[] {
  return computeZeros(depth).slice(0, depth).map(z => z.toString());
}
