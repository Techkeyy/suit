// SUIT — BN254 Groth16 verifier (real on-chain pairing check).
//
// Verifies circom/snarkjs (bn128) Groth16 proofs on Stellar using the BN254
// pairing host functions (Protocol 26). Used for the unlinkable-withdrawal
// proof. Mirrors the BLS12-381 verifier; points are 64 bytes (G1) / 128 (G2).
//
// Byte layout (produced by tools, matched 1:1):
//   VK    : alpha(G1,64) | beta(G2,128) | gamma(G2,128) | delta(G2,128)
//           | ic_len(u32 BE) | IC[..](G1,64 each)
//   PROOF : a(G1,64) | b(G2,128) | c(G1,64)
//   PUBLIC: len(u32 BE) | signal[..](32 BE each)
//
// Groth16: e(-A,B)·e(alpha,beta)·e(vk_x,gamma)·e(C,delta) == 1
// with vk_x = IC[0] + Σ pub_i·IC[i+1].

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl,
    crypto::bn254::{
        Bn254Fr, Bn254G1Affine, Bn254G2Affine, BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE,
    },
    symbol_short, vec, Bytes, BytesN, Env, Symbol, Vec, U256,
};

const VK_KEY: Symbol = symbol_short!("VK");
const G1: usize = BN254_G1_SERIALIZED_SIZE; // 64
const G2: usize = BN254_G2_SERIALIZED_SIZE; // 128

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    MalformedVerifyingKey = 1,
    VerificationKeyNotSet = 2,
    MalformedProof = 3,
    MalformedPublicSignals = 4,
}

fn take<const N: usize>(b: &Bytes, pos: &mut u32, e: VerifierError) -> Result<[u8; N], VerifierError> {
    let end = pos.checked_add(N as u32).ok_or(e)?;
    if end > b.len() {
        return Err(e);
    }
    let mut arr = [0u8; N];
    b.slice(*pos..end).copy_into_slice(&mut arr);
    *pos = end;
    Ok(arr)
}

fn g1(env: &Env, arr: [u8; G1]) -> Bn254G1Affine {
    Bn254G1Affine::from_bytes(BytesN::from_array(env, &arr))
}
fn g2(env: &Env, arr: [u8; G2]) -> Bn254G2Affine {
    Bn254G2Affine::from_bytes(BytesN::from_array(env, &arr))
}

struct VerificationKey {
    alpha: Bn254G1Affine,
    beta: Bn254G2Affine,
    gamma: Bn254G2Affine,
    delta: Bn254G2Affine,
    ic: Vec<Bn254G1Affine>,
}

impl VerificationKey {
    fn parse(env: &Env, b: &Bytes) -> Result<Self, VerifierError> {
        let e = VerifierError::MalformedVerifyingKey;
        let mut p = 0u32;
        let alpha = g1(env, take::<G1>(b, &mut p, e)?);
        let beta = g2(env, take::<G2>(b, &mut p, e)?);
        let gamma = g2(env, take::<G2>(b, &mut p, e)?);
        let delta = g2(env, take::<G2>(b, &mut p, e)?);
        let ic_len = u32::from_be_bytes(take::<4>(b, &mut p, e)?);
        let mut ic = Vec::new(env);
        for _ in 0..ic_len {
            ic.push_back(g1(env, take::<G1>(b, &mut p, e)?));
        }
        if p != b.len() || ic_len == 0 {
            return Err(e);
        }
        Ok(Self { alpha, beta, gamma, delta, ic })
    }
}

fn parse_proof(env: &Env, b: &Bytes) -> Result<(Bn254G1Affine, Bn254G2Affine, Bn254G1Affine), VerifierError> {
    let e = VerifierError::MalformedProof;
    let mut p = 0u32;
    let a = g1(env, take::<G1>(b, &mut p, e)?);
    let bb = g2(env, take::<G2>(b, &mut p, e)?);
    let c = g1(env, take::<G1>(b, &mut p, e)?);
    if p != b.len() {
        return Err(e);
    }
    Ok((a, bb, c))
}

fn parse_signals(env: &Env, b: &Bytes) -> Result<Vec<Bn254Fr>, VerifierError> {
    let e = VerifierError::MalformedPublicSignals;
    let mut p = 0u32;
    let len = u32::from_be_bytes(take::<4>(b, &mut p, e)?);
    let mut out = Vec::new(env);
    for _ in 0..len {
        let arr = take::<32>(b, &mut p, e)?;
        let u = U256::from_be_bytes(env, &Bytes::from_array(env, &arr));
        out.push_back(Bn254Fr::from_u256(u));
    }
    if p != b.len() {
        return Err(e);
    }
    Ok(out)
}

#[contract]
pub struct Bn254Verifier;

#[contractimpl]
impl Bn254Verifier {
    pub fn set_vk(env: Env, vk_bytes: Bytes) -> Result<(), VerifierError> {
        let _ = VerificationKey::parse(&env, &vk_bytes)?;
        env.storage().instance().set(&VK_KEY, &vk_bytes);
        Ok(())
    }

    pub fn verify(env: Env, proof_bytes: Bytes, pub_signals_bytes: Bytes) -> Result<bool, VerifierError> {
        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&VK_KEY)
            .ok_or(VerifierError::VerificationKeyNotSet)?;
        let vk = VerificationKey::parse(&env, &vk_bytes)?;
        let (a, b, c) = parse_proof(&env, &proof_bytes)?;
        let signals = parse_signals(&env, &pub_signals_bytes)?;

        if signals.len() + 1 != vk.ic.len() {
            return Err(VerifierError::MalformedPublicSignals);
        }

        let bn = env.crypto().bn254();
        let mut vk_x = vk.ic.get(0).unwrap();
        for (s, v) in signals.iter().zip(vk.ic.iter().skip(1)) {
            vk_x = bn.g1_add(&vk_x, &bn.g1_mul(&v, &s));
        }

        let neg_a = -&a;
        let vp1 = vec![&env, neg_a, vk.alpha.clone(), vk_x, c];
        let vp2 = vec![&env, b, vk.beta.clone(), vk.gamma.clone(), vk.delta.clone()];
        Ok(bn.pairing_check(vp1, vp2))
    }

    pub fn has_vk(env: Env) -> bool {
        env.storage().instance().has(&VK_KEY)
    }
}

#[cfg(test)]
mod test;
