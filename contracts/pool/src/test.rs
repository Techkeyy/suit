#![cfg(test)]
// Tests the real pool state machine independently of the cryptographic
// verifier: a mock verifier lets us drive the accept/reject branch, and we
// recompute the Merkle tree in-test (same keccak rules as the contract) to
// exercise a genuine deposit → withdraw cycle with nullifier protection.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{
    contract, contractimpl, vec, Address, Bytes, BytesN, Env, Vec,
};

use crate::{PoolError, SuitPool, SuitPoolClient};

const DEPTH: u32 = 16;

// Mock Groth16 verifier: returns true iff the first proof byte is 1. Lets the
// test choose the verification outcome deterministically.
#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify(_env: Env, proof_bytes: Bytes, _pub: Bytes) -> bool {
        !proof_bytes.is_empty() && proof_bytes.get(0).unwrap() == 1
    }
}

struct Fixture {
    env: Env,
    pool: SuitPoolClient<'static>,
    token_admin: soroban_sdk::token::StellarAssetClient<'static>,
    token: soroban_sdk::token::TokenClient<'static>,
    depositor: Address,
    denom: i128,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let token = soroban_sdk::token::TokenClient::new(&env, &token_addr);

    let verifier = env.register(MockVerifier, ());
    let pool_id = env.register(SuitPool, ());
    let pool = SuitPoolClient::new(&env, &pool_id);

    let denom: i128 = 100_0000000; // 100 units (7 decimals)
    pool.initialize(&token_addr, &verifier, &denom);

    let depositor = Address::generate(&env);
    token_admin.mint(&depositor, &(denom * 10));

    Fixture { env, pool, token_admin, token, depositor, denom }
}

fn valid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[1u8])
}
fn invalid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0u8])
}
// Public-signals blob whose 3rd signal (offset 68..100) equals `commitment`,
// matching the encoding the pool's commitment-binding check expects.
fn pub_for(env: &Env, commitment: &BytesN<32>) -> Bytes {
    let mut v = [0u8; 100];
    v[3] = 3; // u32 BE: 3 public signals
    v[68..100].copy_from_slice(&commitment.to_array());
    Bytes::from_array(env, &v)
}

// --- recompute the contract's keccak tree primitives in-test ---

fn hash_pair(env: &Env, l: &BytesN<32>, r: &BytesN<32>) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(&Bytes::from_array(env, &l.to_array()));
    buf.append(&Bytes::from_array(env, &r.to_array()));
    env.crypto().keccak256(&buf).into()
}

fn zeros(env: &Env, level: u32) -> BytesN<32> {
    let seed = Bytes::from_array(env, b"SUIT_ZERO_LEAF_V1______________");
    let mut node: BytesN<32> = env.crypto().keccak256(&seed).into();
    let mut i = 0;
    while i < level {
        node = hash_pair(env, &node, &node);
        i += 1;
    }
    node
}

#[test]
fn deposit_requires_valid_proof() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);

    // Invalid proof → rejected, no funds moved.
    let res = f.pool.try_deposit(
        &f.depositor,
        &commitment,
        &invalid_proof(&f.env),
        &Bytes::new(&f.env),
    );
    assert_eq!(res, Err(Ok(PoolError::InvalidProof)));
    assert_eq!(f.pool.get_count(), 0);
    assert_eq!(f.token.balance(&f.depositor), f.denom * 10);
}

#[test]
fn deposit_inserts_commitment_and_pulls_funds() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);

    let idx = f.pool.deposit(
        &f.depositor,
        &commitment,
        &valid_proof(&f.env),
        &pub_for(&f.env, &commitment),
    );
    assert_eq!(idx, 0);
    assert_eq!(f.pool.get_count(), 1);
    assert_eq!(f.token.balance(&f.depositor), f.denom * 9);
}

#[test]
fn deposit_rejects_commitment_proof_mismatch() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);
    let other = BytesN::from_array(&f.env, &[9u8; 32]);
    // valid proof, but public signals commit to a DIFFERENT value than the leaf
    let res = f.pool.try_deposit(
        &f.depositor,
        &commitment,
        &valid_proof(&f.env),
        &pub_for(&f.env, &other),
    );
    assert_eq!(res, Err(Ok(PoolError::CommitmentMismatch)));
    assert_eq!(f.pool.get_count(), 0);
}

#[test]
fn duplicate_commitment_rejected() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);
    f.pool.deposit(&f.depositor, &commitment, &valid_proof(&f.env), &pub_for(&f.env, &commitment));
    let res = f.pool.try_deposit(
        &f.depositor,
        &commitment,
        &valid_proof(&f.env),
        &Bytes::new(&f.env),
    );
    assert_eq!(res, Err(Ok(PoolError::DuplicateCommitment)));
}

#[test]
fn full_deposit_withdraw_cycle() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[42u8; 32]);

    f.pool.deposit(&f.depositor, &commitment, &valid_proof(&f.env), &pub_for(&f.env, &commitment));
    let root = f.pool.get_root();

    // Single leaf at index 0: every sibling is the zero subtree, every
    // direction bit is 0 (left).
    let mut path_elements: Vec<BytesN<32>> = Vec::new(&f.env);
    let mut path_indices: Vec<u32> = Vec::new(&f.env);
    for i in 0..DEPTH {
        path_elements.push_back(zeros(&f.env, i));
        path_indices.push_back(0u32);
    }

    // Sanity: recomputed root matches the contract's root.
    let mut node = commitment.clone();
    for i in 0..DEPTH {
        node = hash_pair(&f.env, &node, &path_elements.get(i).unwrap());
    }
    assert_eq!(node, root);

    let recipient = Address::generate(&f.env);
    let nullifier = BytesN::from_array(&f.env, &[99u8; 32]);

    f.pool.withdraw(
        &recipient,
        &nullifier,
        &commitment,
        &path_elements,
        &path_indices,
        &root,
    );
    assert_eq!(f.token.balance(&recipient), f.denom);
    assert!(f.pool.is_spent(&nullifier));

    // Second withdraw with same nullifier → rejected.
    let res = f.pool.try_withdraw(
        &recipient,
        &nullifier,
        &commitment,
        &path_elements,
        &path_indices,
        &root,
    );
    assert_eq!(res, Err(Ok(PoolError::NullifierAlreadySpent)));
}

#[test]
fn withdraw_unknown_root_rejected() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[42u8; 32]);
    f.pool.deposit(&f.depositor, &commitment, &valid_proof(&f.env), &pub_for(&f.env, &commitment));

    let bogus_root = BytesN::from_array(&f.env, &[1u8; 32]);
    let mut path_elements: Vec<BytesN<32>> = Vec::new(&f.env);
    let mut path_indices: Vec<u32> = Vec::new(&f.env);
    for i in 0..DEPTH {
        path_elements.push_back(zeros(&f.env, i));
        path_indices.push_back(0u32);
    }
    let recipient = Address::generate(&f.env);
    let nullifier = BytesN::from_array(&f.env, &[99u8; 32]);
    let res = f.pool.try_withdraw(
        &recipient, &nullifier, &commitment, &path_elements, &path_indices, &bogus_root,
    );
    assert_eq!(res, Err(Ok(PoolError::UnknownRoot)));
    let _ = vec![&f.env, 1u32]; // keep `vec` import used
}
