// circomlib-compatible BN254 Poseidon (host permutation, CAP-0075) — proven
// byte-identical to circomlib / poseidon-lite by the spike. 2-to-1 hash used to
// build the on-chain commitment tree so it matches the in-circuit / in-browser
// Merkle roots exactly.

use crate::params::{C_HEX, M_HEX};
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

/// Prebuilt circomlib t=3 constants (build once per tx, reuse across hashes).
pub struct Params {
    pub rc: Vec<Vec<U256>>,
    pub mds: Vec<Vec<U256>>,
}

pub fn params(env: &Env) -> Params {
    let mut rc: Vec<Vec<U256>> = Vec::new(env);
    for x in 0..65usize {
        let mut row: Vec<U256> = Vec::new(env);
        for y in 0..3usize {
            row.push_back(u256(env, C_HEX[x * 3 + y]));
        }
        rc.push_back(row);
    }
    let mut mds: Vec<Vec<U256>> = Vec::new(env);
    for x in 0..3usize {
        let mut row: Vec<U256> = Vec::new(env);
        for y in 0..3usize {
            row.push_back(u256(env, M_HEX[x * 3 + y]));
        }
        mds.push_back(row);
    }
    Params { rc, mds }
}

/// circomlib Poseidon(2): state = [0, a, b], one permutation, output state[0].
pub fn hash2(env: &Env, p: &Params, a: &U256, b: &U256) -> U256 {
    let mut input: Vec<U256> = Vec::new(env);
    input.push_back(U256::from_u32(env, 0));
    input.push_back(a.clone());
    input.push_back(b.clone());
    let out = env
        .crypto_hazmat()
        .poseidon_permutation(&input, symbol_short!("BN254"), 3, 5, 8, 57, &p.mds, &p.rc);
    out.get(0).unwrap()
}

/// Zero-subtree values [0..=depth], zero leaf = 0.
pub fn zeros(env: &Env, p: &Params, depth: u32) -> Vec<U256> {
    let mut z: Vec<U256> = Vec::new(env);
    z.push_back(U256::from_u32(env, 0));
    for i in 1..=depth {
        let prev = z.get(i - 1).unwrap();
        z.push_back(hash2(env, p, &prev, &prev));
    }
    z
}
