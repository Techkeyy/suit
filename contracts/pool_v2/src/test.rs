#![cfg(test)]
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

use crate::{PoolError, SuitPoolV2, SuitPoolV2Client};

const DENOM: i128 = 100_0000000;

// Mock BN254 verifier: true iff first proof byte is 1.
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
    pool: SuitPoolV2Client<'static>,
    token: soroban_sdk::token::TokenClient<'static>,
    depositor: Address,
}

fn setup() -> F {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token = soroban_sdk::token::TokenClient::new(&env, &token_addr);
    soroban_sdk::token::StellarAssetClient::new(&env, &token_addr)
        .mint(&Address::generate(&env), &0); // touch admin client
    let depositor = Address::generate(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &token_addr).mint(&depositor, &(DENOM * 10));

    let verifier = env.register(MockVerifier, ());
    let pool_id = env.register(SuitPoolV2, ());
    let pool = SuitPoolV2Client::new(&env, &pool_id);
    pool.initialize(&token_addr, &verifier, &DENOM);

    F { env, pool, token, depositor }
}

fn b32(env: &Env, n: u8) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[31] = n;
    BytesN::from_array(env, &a)
}
fn valid(env: &Env) -> Bytes {
    Bytes::from_array(env, &[1u8])
}

#[test]
fn deposit_inserts_and_changes_root() {
    let f = setup();
    let empty = f.pool.get_root();
    let idx = f.pool.deposit(&f.depositor, &b32(&f.env, 5));
    assert_eq!(idx, 0);
    assert_eq!(f.pool.get_count(), 1);
    assert_eq!(f.token.balance(&f.depositor), DENOM * 9);
    assert!(f.pool.get_root() != empty, "root must change after a deposit");
}

#[test]
fn duplicate_commitment_rejected() {
    let f = setup();
    let c = b32(&f.env, 5);
    f.pool.deposit(&f.depositor, &c);
    let res = f.pool.try_deposit(&f.depositor, &c);
    assert_eq!(res, Err(Ok(PoolError::DuplicateCommitment)));
}

#[test]
fn withdraw_with_valid_proof_pays_and_burns_nullifier() {
    let f = setup();
    f.pool.deposit(&f.depositor, &b32(&f.env, 5));
    let root = f.pool.get_root();
    let recipient = Address::generate(&f.env);
    let nh = b32(&f.env, 99);
    let rf = b32(&f.env, 42);

    f.pool.withdraw(&recipient, &rf, &nh, &root, &valid(&f.env));
    assert_eq!(f.token.balance(&recipient), DENOM);
    assert!(f.pool.is_spent(&nh));

    // double-spend same nullifier
    let res = f.pool.try_withdraw(&recipient, &rf, &nh, &root, &valid(&f.env));
    assert_eq!(res, Err(Ok(PoolError::NullifierAlreadySpent)));
}

#[test]
fn withdraw_unknown_root_rejected() {
    let f = setup();
    f.pool.deposit(&f.depositor, &b32(&f.env, 5));
    let recipient = Address::generate(&f.env);
    let res = f.pool.try_withdraw(
        &recipient,
        &b32(&f.env, 42),
        &b32(&f.env, 99),
        &b32(&f.env, 123), // never a real root
        &valid(&f.env),
    );
    assert_eq!(res, Err(Ok(PoolError::UnknownRoot)));
}

#[test]
fn withdraw_invalid_proof_rejected() {
    let f = setup();
    f.pool.deposit(&f.depositor, &b32(&f.env, 5));
    let root = f.pool.get_root();
    let recipient = Address::generate(&f.env);
    let res = f.pool.try_withdraw(
        &recipient,
        &b32(&f.env, 42),
        &b32(&f.env, 99),
        &root,
        &Bytes::from_array(&f.env, &[0u8]), // mock verifier → false
    );
    assert_eq!(res, Err(Ok(PoolError::InvalidProof)));
}
