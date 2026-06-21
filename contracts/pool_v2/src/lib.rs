// SUIT — pool v2: unlinkable shielded pool.
//
// Deposit posts a commitment = Poseidon(nullifier, secret) into an on-chain
// Poseidon Merkle tree and escrows the denomination. Withdraw submits a Groth16
// proof (verified on-chain by the BN254 verifier) proving the spender knows a
// note whose commitment is in the tree, revealing only:
//   - root          (which tree state)
//   - nullifierHash  (to prevent double-spend)
//   - recipient      (bound into the proof)
// It does NOT reveal which leaf — so deposits and withdrawals are unlinkable.
//
// Single fixed denomination in this version; denomination tiers (one tree per
// size) are layered on top next.

#![no_std]

mod params;
mod poseidon;

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, Bytes, BytesN, Env, Symbol, Vec, U256,
};

const DEPTH: u32 = 16;
const ROOT_HISTORY: u32 = 30;

const INIT: Symbol = symbol_short!("INIT");
const TOKEN: Symbol = symbol_short!("TOKEN");
const VERIFIER: Symbol = symbol_short!("VERIFIER");
const DENOM: Symbol = symbol_short!("DENOM");
const SUBTREES: Symbol = symbol_short!("SUBTREES");
const ROOTS: Symbol = symbol_short!("ROOTS");
const ROOT_IDX: Symbol = symbol_short!("ROOTIDX");
const NEXT_IDX: Symbol = symbol_short!("NEXTIDX");
const COUNT: Symbol = symbol_short!("COUNT");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    DuplicateCommitment = 3,
    TreeFull = 4,
    UnknownRoot = 5,
    NullifierAlreadySpent = 6,
    InvalidProof = 7,
}

#[contracttype]
#[derive(Clone)]
pub struct DepositEvent {
    pub commitment: BytesN<32>,
    pub leaf_index: u32,
    pub root: BytesN<32>,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct WithdrawEvent {
    pub nullifier_hash: BytesN<32>,
    pub recipient: Address,
    pub timestamp: u64,
}

#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify(env: Env, proof_bytes: Bytes, pub_signals_bytes: Bytes) -> bool;
}

fn to_u256(env: &Env, b: &BytesN<32>) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &b.to_array()))
}
fn to_bytes32(env: &Env, u: &U256) -> BytesN<32> {
    let mut arr = [0u8; 32];
    u.to_be_bytes().copy_into_slice(&mut arr);
    BytesN::from_array(env, &arr)
}

#[contract]
pub struct SuitPoolV2;

#[contractimpl]
impl SuitPoolV2 {
    pub fn initialize(
        env: Env,
        token: Address,
        verifier: Address,
        denomination: i128,
    ) -> Result<(), PoolError> {
        if env.storage().instance().has(&INIT) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&INIT, &true);
        env.storage().instance().set(&TOKEN, &token);
        env.storage().instance().set(&VERIFIER, &verifier);
        env.storage().instance().set(&DENOM, &denomination);

        let p = poseidon::params(&env);
        let z = poseidon::zeros(&env, &p, DEPTH);

        let mut subtrees: Vec<U256> = Vec::new(&env);
        for i in 0..DEPTH {
            subtrees.push_back(z.get(i).unwrap());
        }
        env.storage().instance().set(&SUBTREES, &subtrees);

        let empty_root = z.get(DEPTH).unwrap();
        let mut roots: Vec<U256> = Vec::new(&env);
        for _ in 0..ROOT_HISTORY {
            roots.push_back(empty_root.clone());
        }
        env.storage().instance().set(&ROOTS, &roots);
        env.storage().instance().set(&ROOT_IDX, &0u32);
        env.storage().instance().set(&NEXT_IDX, &0u32);
        env.storage().instance().set(&COUNT, &0u32);
        Ok(())
    }

    /// Deposit the denomination and post a commitment leaf.
    pub fn deposit(env: Env, depositor: Address, commitment: BytesN<32>) -> Result<u32, PoolError> {
        require_init(&env)?;
        depositor.require_auth();

        let comm_key = (symbol_short!("COMM"), commitment.clone());
        if env.storage().persistent().has(&comm_key) {
            return Err(PoolError::DuplicateCommitment);
        }

        let token_addr: Address = env.storage().instance().get(&TOKEN).unwrap();
        let denom: i128 = env.storage().instance().get(&DENOM).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &depositor,
            &env.current_contract_address(),
            &denom,
        );

        let leaf = to_u256(&env, &commitment);
        let leaf_index = insert_leaf(&env, &leaf)?;
        env.storage().persistent().set(&comm_key, &leaf_index);

        let count: u32 = env.storage().instance().get(&COUNT).unwrap();
        env.storage().instance().set(&COUNT, &(count + 1));

        let root = to_bytes32(&env, &current_root(&env));
        env.events().publish(
            (symbol_short!("deposit"),),
            DepositEvent { commitment, leaf_index, root, timestamp: env.ledger().timestamp() },
        );
        Ok(leaf_index)
    }

    /// Withdraw by proving (in ZK) ownership of a note in the tree.
    pub fn withdraw(
        env: Env,
        recipient: Address,
        recipient_field: BytesN<32>,
        nullifier_hash: BytesN<32>,
        root: BytesN<32>,
        proof_bytes: Bytes,
    ) -> Result<(), PoolError> {
        require_init(&env)?;

        // root must be one the pool recently produced
        let root_u = to_u256(&env, &root);
        if !is_known_root(&env, &root_u) {
            return Err(PoolError::UnknownRoot);
        }

        // nullifier must be unused
        let null_key = (symbol_short!("NULL"), nullifier_hash.clone());
        if env.storage().persistent().has(&null_key) {
            return Err(PoolError::NullifierAlreadySpent);
        }

        // Build the exact public signals the circuit committed to:
        // [root, nullifierHash, recipient] — so the proof can't be re-pointed.
        let mut pub_signals = Bytes::from_array(&env, &3u32.to_be_bytes());
        pub_signals.append(&Bytes::from_array(&env, &root.to_array()));
        pub_signals.append(&Bytes::from_array(&env, &nullifier_hash.to_array()));
        pub_signals.append(&Bytes::from_array(&env, &recipient_field.to_array()));

        let verifier: Address = env.storage().instance().get(&VERIFIER).unwrap();
        let ok = VerifierClient::new(&env, &verifier).verify(&proof_bytes, &pub_signals);
        if !ok {
            return Err(PoolError::InvalidProof);
        }

        // burn nullifier, pay out
        env.storage().persistent().set(&null_key, &true);
        let token_addr: Address = env.storage().instance().get(&TOKEN).unwrap();
        let denom: i128 = env.storage().instance().get(&DENOM).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &recipient,
            &denom,
        );

        env.events().publish(
            (symbol_short!("withdraw"),),
            WithdrawEvent { nullifier_hash, recipient, timestamp: env.ledger().timestamp() },
        );
        Ok(())
    }

    pub fn get_root(env: Env) -> BytesN<32> {
        to_bytes32(&env, &current_root(&env))
    }
    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&COUNT).unwrap_or(0)
    }
    pub fn is_spent(env: Env, nullifier_hash: BytesN<32>) -> bool {
        env.storage().persistent().has(&(symbol_short!("NULL"), nullifier_hash))
    }
    pub fn known_root(env: Env, root: BytesN<32>) -> bool {
        let u = to_u256(&env, &root);
        is_known_root(&env, &u)
    }
}

fn require_init(env: &Env) -> Result<(), PoolError> {
    if env.storage().instance().has(&INIT) {
        Ok(())
    } else {
        Err(PoolError::NotInitialized)
    }
}

fn insert_leaf(env: &Env, leaf: &U256) -> Result<u32, PoolError> {
    let next_index: u32 = env.storage().instance().get(&NEXT_IDX).unwrap();
    if next_index >= (1u32 << DEPTH) {
        return Err(PoolError::TreeFull);
    }
    let p = poseidon::params(env);
    let z = poseidon::zeros(env, &p, DEPTH);
    let mut subtrees: Vec<U256> = env.storage().instance().get(&SUBTREES).unwrap();

    let mut current_index = next_index;
    let mut current_hash = leaf.clone();
    for i in 0..DEPTH {
        if current_index % 2 == 0 {
            subtrees.set(i, current_hash.clone());
            let right = z.get(i).unwrap();
            current_hash = poseidon::hash2(env, &p, &current_hash, &right);
        } else {
            let left = subtrees.get(i).unwrap();
            current_hash = poseidon::hash2(env, &p, &left, &current_hash);
        }
        current_index /= 2;
    }
    env.storage().instance().set(&SUBTREES, &subtrees);

    let root_idx: u32 = env.storage().instance().get(&ROOT_IDX).unwrap();
    let new_root_idx = (root_idx + 1) % ROOT_HISTORY;
    let mut roots: Vec<U256> = env.storage().instance().get(&ROOTS).unwrap();
    roots.set(new_root_idx, current_hash);
    env.storage().instance().set(&ROOTS, &roots);
    env.storage().instance().set(&ROOT_IDX, &new_root_idx);
    env.storage().instance().set(&NEXT_IDX, &(next_index + 1));
    Ok(next_index)
}

fn current_root(env: &Env) -> U256 {
    let idx: u32 = env.storage().instance().get(&ROOT_IDX).unwrap_or(0);
    let roots: Vec<U256> = env
        .storage()
        .instance()
        .get(&ROOTS)
        .unwrap_or_else(|| Vec::new(env));
    roots.get(idx).unwrap_or_else(|| U256::from_u32(env, 0))
}

fn is_known_root(env: &Env, root: &U256) -> bool {
    let roots: Vec<U256> = match env.storage().instance().get(&ROOTS) {
        Some(r) => r,
        None => return false,
    };
    for r in roots.iter() {
        if &r == root {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod test;
