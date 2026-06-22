#![cfg(test)]
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, vec, Address, Bytes, BytesN, Env, Vec};

use crate::{PoolError, SuitPoolV3, SuitPoolV3Client};

#[contract]
pub struct MockVerifier;
#[contractimpl]
impl MockVerifier {
    pub fn verify(_e: Env, proof_bytes: Bytes, _pub: Bytes) -> bool {
        !proof_bytes.is_empty() && proof_bytes.get(0).unwrap() == 1
    }
}

struct F {
    env: Env,
    pool: SuitPoolV3Client<'static>,
    token: soroban_sdk::token::TokenClient<'static>,
    user: Address,
    minted: i128,
}

fn setup() -> F {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token = soroban_sdk::token::TokenClient::new(&env, &token_addr);
    let user = Address::generate(&env);
    let minted: i128 = 1000_0000000;
    soroban_sdk::token::StellarAssetClient::new(&env, &token_addr).mint(&user, &minted);

    let verifier = env.register(MockVerifier, ());
    let pool_id = env.register(SuitPoolV3, ());
    let pool = SuitPoolV3Client::new(&env, &pool_id);
    pool.initialize(&token_addr, &verifier);
    F { env, pool, token, user, minted }
}

fn b32(env: &Env, n: u8) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[31] = n;
    BytesN::from_array(env, &a)
}
fn ok_proof(env: &Env) -> Bytes { Bytes::from_array(env, &[1u8]) }

#[test]
fn deposit_moves_funds_and_inserts_outputs() {
    let f = setup();
    let root = f.pool.get_root(); // empty root is known
    let nulls: Vec<BytesN<32>> = vec![&f.env, b32(&f.env, 1), b32(&f.env, 2)];
    let outs: Vec<BytesN<32>> = vec![&f.env, b32(&f.env, 10), b32(&f.env, 11)];
    let anyone = Address::generate(&f.env);

    f.pool.transact(&ok_proof(&f.env), &root, &137_0000000i128, &b32(&f.env, 7), &nulls, &outs, &f.user, &anyone);
    assert_eq!(f.token.balance(&f.user), f.minted - 137_0000000);
    assert_eq!(f.pool.get_count(), 2); // two output commitments inserted
    assert!(f.pool.nullifier_spent(&b32(&f.env, 1)));
}

#[test]
fn withdraw_pays_recipient() {
    let f = setup();
    // deposit 200 first
    let r0 = f.pool.get_root();
    f.pool.transact(&ok_proof(&f.env), &r0, &200_0000000i128, &b32(&f.env, 7),
        &vec![&f.env, b32(&f.env, 1), b32(&f.env, 2)],
        &vec![&f.env, b32(&f.env, 10), b32(&f.env, 11)], &f.user, &f.user);

    // withdraw 50 to a fresh recipient
    let recipient = Address::generate(&f.env);
    let r1 = f.pool.get_root();
    f.pool.transact(&ok_proof(&f.env), &r1, &(-50_0000000i128), &b32(&f.env, 8),
        &vec![&f.env, b32(&f.env, 3), b32(&f.env, 4)],
        &vec![&f.env, b32(&f.env, 12), b32(&f.env, 13)], &f.user, &recipient);

    assert_eq!(f.token.balance(&recipient), 50_0000000);
}

#[test]
fn double_spend_nullifier_rejected() {
    let f = setup();
    let r = f.pool.get_root();
    f.pool.transact(&ok_proof(&f.env), &r, &100_0000000i128, &b32(&f.env, 7),
        &vec![&f.env, b32(&f.env, 1), b32(&f.env, 2)],
        &vec![&f.env, b32(&f.env, 10), b32(&f.env, 11)], &f.user, &f.user);
    let r2 = f.pool.get_root();
    // reuse nullifier 1
    let res = f.pool.try_transact(&ok_proof(&f.env), &r2, &0i128, &b32(&f.env, 7),
        &vec![&f.env, b32(&f.env, 1), b32(&f.env, 5)],
        &vec![&f.env, b32(&f.env, 14), b32(&f.env, 15)], &f.user, &f.user);
    assert_eq!(res, Err(Ok(PoolError::NullifierAlreadySpent)));
}

#[test]
fn unknown_root_rejected() {
    let f = setup();
    let res = f.pool.try_transact(&ok_proof(&f.env), &b32(&f.env, 200), &0i128, &b32(&f.env, 7),
        &vec![&f.env, b32(&f.env, 1), b32(&f.env, 2)],
        &vec![&f.env, b32(&f.env, 10), b32(&f.env, 11)], &f.user, &f.user);
    assert_eq!(res, Err(Ok(PoolError::UnknownRoot)));
}

#[test]
fn invalid_proof_rejected() {
    let f = setup();
    let r = f.pool.get_root();
    let res = f.pool.try_transact(&Bytes::from_array(&f.env, &[0u8]), &r, &100_0000000i128, &b32(&f.env, 7),
        &vec![&f.env, b32(&f.env, 1), b32(&f.env, 2)],
        &vec![&f.env, b32(&f.env, 10), b32(&f.env, 11)], &f.user, &f.user);
    assert_eq!(res, Err(Ok(PoolError::InvalidProof)));
}
