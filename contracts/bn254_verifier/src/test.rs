#![cfg(test)]
extern crate std;

use soroban_sdk::{Bytes, Env};

use crate::{Bn254Verifier, Bn254VerifierClient, VerifierError};

const VK_HEX: &str = include_str!("test_data/vk.hex");
const PROOF_HEX: &str = include_str!("test_data/proof.hex");
const PUBLIC_HEX: &str = include_str!("test_data/public.hex");

fn decode_hex(s: &str) -> std::vec::Vec<u8> {
    let s = s.trim();
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}
fn bytes(env: &Env, hex: &str) -> Bytes {
    Bytes::from_slice(env, &decode_hex(hex))
}
fn setup(env: &Env) -> Bn254VerifierClient {
    let id = env.register(Bn254Verifier, ());
    let c = Bn254VerifierClient::new(env, &id);
    c.set_vk(&bytes(env, VK_HEX));
    c
}

#[test]
fn accepts_valid_withdrawal_proof() {
    let env = Env::default();
    let c = setup(&env);
    assert!(c.verify(&bytes(&env, PROOF_HEX), &bytes(&env, PUBLIC_HEX)));
}

#[test]
fn rejects_tampered_public_signals() {
    let env = Env::default();
    let c = setup(&env);
    let mut pb = decode_hex(PUBLIC_HEX);
    let last = pb.len() - 1;
    pb[last] ^= 0x01;
    assert!(!c.verify(&bytes(&env, PROOF_HEX), &Bytes::from_slice(&env, &pb)));
}

#[test]
fn rejects_malformed_proof() {
    let env = Env::default();
    let c = setup(&env);
    let mut pf = decode_hex(PROOF_HEX);
    pf.truncate(pf.len() - 8);
    let res = c.try_verify(&Bytes::from_slice(&env, &pf), &bytes(&env, PUBLIC_HEX));
    assert_eq!(res, Err(Ok(VerifierError::MalformedProof)));
}
