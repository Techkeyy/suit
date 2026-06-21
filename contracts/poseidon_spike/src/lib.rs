#![no_std]
//! Spike → reusable: circomlib-compatible BN254 Poseidon + Merkle tree on
//! Soroban, using the host Poseidon permutation (CAP-0075) fed circomlib's
//! constants. Proven byte-identical to circomlib (poseidon-lite in JS, circomlib
//! in-circuit). This module is the basis for pool v2's on-chain commitment tree.

mod params;

use soroban_sdk::{symbol_short, Bytes, Env, Vec, U256};

fn decode32(s: &str) -> [u8; 32] {
    let mut a = [0u8; 32];
    let b = s.as_bytes();
    let mut i = 0;
    while i < 32 {
        let hi = (b[i * 2] as char).to_digit(16).unwrap() as u8;
        let lo = (b[i * 2 + 1] as char).to_digit(16).unwrap() as u8;
        a[i] = (hi << 4) | lo;
        i += 1;
    }
    a
}
fn u256(env: &Env, hex: &str) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &decode32(hex)))
}

/// circomlib t=3 round constants as a 65 x 3 matrix.
pub fn round_constants(env: &Env) -> Vec<Vec<U256>> {
    let mut rc: Vec<Vec<U256>> = Vec::new(env);
    for x in 0..65usize {
        let mut row: Vec<U256> = Vec::new(env);
        for y in 0..3usize {
            row.push_back(u256(env, params::C_HEX[x * 3 + y]));
        }
        rc.push_back(row);
    }
    rc
}
/// circomlib t=3 MDS matrix (3 x 3).
pub fn mds(env: &Env) -> Vec<Vec<U256>> {
    let mut m: Vec<Vec<U256>> = Vec::new(env);
    for x in 0..3usize {
        let mut row: Vec<U256> = Vec::new(env);
        for y in 0..3usize {
            row.push_back(u256(env, params::M_HEX[x * 3 + y]));
        }
        m.push_back(row);
    }
    m
}

/// circomlib-compatible Poseidon hash of two field elements.
/// Sponge: state = [0, a, b], one permutation, output state[0].
pub fn poseidon2(env: &Env, rc: &Vec<Vec<U256>>, mds: &Vec<Vec<U256>>, a: &U256, b: &U256) -> U256 {
    let mut input: Vec<U256> = Vec::new(env);
    input.push_back(U256::from_u32(env, 0));
    input.push_back(a.clone());
    input.push_back(b.clone());
    let out = env
        .crypto_hazmat()
        .poseidon_permutation(&input, symbol_short!("BN254"), 3, 5, 8, 57, mds, rc);
    out.get(0).unwrap()
}

/// Zero-subtree value at `level` (zero leaf = 0).
pub fn zero(env: &Env, rc: &Vec<Vec<U256>>, mds: &Vec<Vec<U256>>, level: u32) -> U256 {
    let mut z = U256::from_u32(env, 0);
    let mut i = 0;
    while i < level {
        z = poseidon2(env, rc, mds, &z, &z);
        i += 1;
    }
    z
}

/// Full fixed-depth Merkle root for `leaves`; empty slots use the zero subtree.
pub fn merkle_root(env: &Env, leaves: &Vec<U256>, depth: u32) -> U256 {
    let rc = round_constants(env);
    let m = mds(env);
    let mut level = leaves.clone();
    for d in 0..depth {
        let mut next: Vec<U256> = Vec::new(env);
        let width = 1u32 << (depth - d - 1);
        let zd = zero(env, &rc, &m, d);
        for i in 0..width {
            let li = 2 * i;
            let ri = 2 * i + 1;
            let l = if li < level.len() { level.get(li).unwrap() } else { zd.clone() };
            let r = if ri < level.len() { level.get(ri).unwrap() } else { zd.clone() };
            next.push_back(poseidon2(env, &rc, &m, &l, &r));
        }
        level = next;
    }
    level.get(0).unwrap()
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use crate::params::EXPECTED_HEX;

    #[test]
    fn host_poseidon_matches_circomlib() {
        let env = Env::default();
        let rc = round_constants(&env);
        let m = mds(&env);
        let got = poseidon2(&env, &rc, &m, &U256::from_u32(&env, 1), &U256::from_u32(&env, 2));
        assert_eq!(got, u256(&env, EXPECTED_HEX));
    }

    #[test]
    fn merkle_root_matches_js() {
        let env = Env::default();
        let mut leaves: Vec<U256> = Vec::new(&env);
        leaves.push_back(U256::from_u32(&env, 1));
        leaves.push_back(U256::from_u32(&env, 2));
        leaves.push_back(U256::from_u32(&env, 3));
        let root = merkle_root(&env, &leaves, 4);
        // poseidon-lite root([1,2,3], depth=4, zero=0)
        let expected = u256(&env, "0f8ce36adf46d0fae68d33d37dcad953c2911048e49e5d8bcac1c4435cc75621");
        assert_eq!(root, expected);
    }
}
