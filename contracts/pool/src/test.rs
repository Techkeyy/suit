#![cfg(test)]
// Tests the real pool state machine independently of the cryptographic
// verifier: a mock verifier lets us drive the accept/reject branch, and we
// recompute the Merkle tree in-test (same keccak rules as the contract) to
// exercise a genuine deposit → withdraw cycle with nullifier protection.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, vec, Address, Bytes, BytesN, Env, Vec};

use crate::{PoolError, SuitPool, SuitPoolClient};

const DEPTH: u32 = 16;
const AMOUNT: i128 = 137_0000000; // 137 XLM — deliberately not the 100 default

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
    token: soroban_sdk::token::TokenClient<'static>,
    depositor: Address,
    minted: i128,
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

    pool.initialize(&token_addr, &verifier, &100_0000000i128);

    let depositor = Address::generate(&env);
    let minted: i128 = 1000_0000000; // 1000 XLM
    token_admin.mint(&depositor, &minted);

    Fixture { env, pool, token, depositor, minted }
}

fn valid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[1u8])
}
fn invalid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0u8])
}
// Public-signals blob whose 3rd signal (offset 68..100) equals `commitment`.
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
    let res = f.pool.try_deposit(
        &f.depositor,
        &commitment,
        &AMOUNT,
        &invalid_proof(&f.env),
        &Bytes::new(&f.env),
    );
    assert_eq!(res, Err(Ok(PoolError::InvalidProof)));
    assert_eq!(f.pool.get_count(), 0);
    assert_eq!(f.token.balance(&f.depositor), f.minted);
}

#[test]
fn deposit_rejects_commitment_proof_mismatch() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);
    let other = BytesN::from_array(&f.env, &[9u8; 32]);
    let res = f.pool.try_deposit(
        &f.depositor,
        &commitment,
        &AMOUNT,
        &valid_proof(&f.env),
        &pub_for(&f.env, &other),
    );
    assert_eq!(res, Err(Ok(PoolError::CommitmentMismatch)));
    assert_eq!(f.pool.get_count(), 0);
}

#[test]
fn deposit_inserts_commitment_and_pulls_funds() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);
    let idx = f.pool.deposit(
        &f.depositor,
        &commitment,
        &AMOUNT,
        &valid_proof(&f.env),
        &pub_for(&f.env, &commitment),
    );
    assert_eq!(idx, 0);
    assert_eq!(f.pool.get_count(), 1);
    assert_eq!(f.token.balance(&f.depositor), f.minted - AMOUNT);
}

#[test]
fn deposit_rejects_zero_amount() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);
    let res = f.pool.try_deposit(
        &f.depositor,
        &commitment,
        &0i128,
        &valid_proof(&f.env),
        &pub_for(&f.env, &commitment),
    );
    assert_eq!(res, Err(Ok(PoolError::InvalidAmount)));
}

#[test]
fn duplicate_commitment_rejected() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[7u8; 32]);
    f.pool.deposit(&f.depositor, &commitment, &AMOUNT, &valid_proof(&f.env), &pub_for(&f.env, &commitment));
    let res = f.pool.try_deposit(
        &f.depositor,
        &commitment,
        &AMOUNT,
        &valid_proof(&f.env),
        &pub_for(&f.env, &commitment),
    );
    assert_eq!(res, Err(Ok(PoolError::DuplicateCommitment)));
}

#[test]
fn full_deposit_withdraw_cycle() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[42u8; 32]);
    f.pool.deposit(&f.depositor, &commitment, &AMOUNT, &valid_proof(&f.env), &pub_for(&f.env, &commitment));
    let root = f.pool.get_root();

    let mut path_elements: Vec<BytesN<32>> = Vec::new(&f.env);
    let mut path_indices: Vec<u32> = Vec::new(&f.env);
    for i in 0..DEPTH {
        path_elements.push_back(zeros(&f.env, i));
        path_indices.push_back(0u32);
    }

    // recomputed root matches the contract's root
    let mut node = commitment.clone();
    for i in 0..DEPTH {
        node = hash_pair(&f.env, &node, &path_elements.get(i).unwrap());
    }
    assert_eq!(node, root);

    let recipient = Address::generate(&f.env);
    let nullifier = BytesN::from_array(&f.env, &[99u8; 32]);

    f.pool.withdraw(&recipient, &nullifier, &commitment, &path_elements, &path_indices, &root);
    // recipient receives exactly the deposited amount (flexible, not a fixed denom)
    assert_eq!(f.token.balance(&recipient), AMOUNT);
    assert!(f.pool.is_spent(&nullifier));

    let res = f.pool.try_withdraw(
        &recipient, &nullifier, &commitment, &path_elements, &path_indices, &root,
    );
    assert_eq!(res, Err(Ok(PoolError::NullifierAlreadySpent)));
}

#[test]
fn withdraw_unknown_root_rejected() {
    let f = setup();
    let commitment = BytesN::from_array(&f.env, &[42u8; 32]);
    f.pool.deposit(&f.depositor, &commitment, &AMOUNT, &valid_proof(&f.env), &pub_for(&f.env, &commitment));

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
    let _ = vec![&f.env, 1u32];
}
