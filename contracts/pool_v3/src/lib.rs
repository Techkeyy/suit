// SUIT — pool v3: arbitrary-amount unlinkable pool (Tornado-Nova / Aztec model).
//
// A single transact() spends up to 2 input notes and creates 2 output notes,
// gated by a Groth16 proof of value conservation (verified on-chain). The
// signed `ext_amount` is the net token movement: > 0 deposit, < 0 withdraw,
// 0 internal transfer. Amounts are arbitrary; unlinkability comes from the
// shielded UTXO set + change outputs.
//
// Public signals (order matches Transaction.circom):
//   [ root, publicAmount, extDataHash, inputNullifier[0], inputNullifier[1],
//     outputCommitment[0], outputCommitment[1] ]   (each 32-byte BE)
// where publicAmount = ext_amount mod p (p - |amount| for withdrawals).

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
const SUBTREES: Symbol = symbol_short!("SUBTREES");
const ROOTS: Symbol = symbol_short!("ROOTS");
const ROOT_IDX: Symbol = symbol_short!("ROOTIDX");
const NEXT_IDX: Symbol = symbol_short!("NEXTIDX");
const COUNT: Symbol = symbol_short!("COUNT");

// BN254 scalar field modulus
const P_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    BadArgs = 3,
    UnknownRoot = 4,
    NullifierAlreadySpent = 5,
    DuplicateNullifier = 6,
    InvalidProof = 7,
    TreeFull = 8,
    InvalidExtAmount = 9,
}

#[contracttype]
#[derive(Clone)]
pub struct TransactEvent {
    pub ext_amount: i128,
    pub leaf_index: u32, // index of the first inserted output commitment
    pub out_commitment_0: BytesN<32>,
    pub out_commitment_1: BytesN<32>,
    pub new_root: BytesN<32>,
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
    let mut a = [0u8; 32];
    u.to_be_bytes().copy_into_slice(&mut a);
    BytesN::from_array(env, &a)
}
fn u128_to_u256(env: &Env, v: u128) -> U256 {
    let mut a = [0u8; 32];
    a[16..32].copy_from_slice(&v.to_be_bytes());
    U256::from_be_bytes(env, &Bytes::from_array(env, &a))
}
/// ext_amount → field element (p - |amount| for negatives)
fn public_amount(env: &Env, ext_amount: i128) -> U256 {
    if ext_amount >= 0 {
        u128_to_u256(env, ext_amount as u128)
    } else {
        let p = U256::from_be_bytes(env, &Bytes::from_array(env, &P_BE));
        let abs = u128_to_u256(env, (-ext_amount) as u128);
        p.sub(&abs)
    }
}

#[contract]
pub struct SuitPoolV3;

#[contractimpl]
impl SuitPoolV3 {
    pub fn initialize(env: Env, token: Address, verifier: Address) -> Result<(), PoolError> {
        if env.storage().instance().has(&INIT) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&INIT, &true);
        env.storage().instance().set(&TOKEN, &token);
        env.storage().instance().set(&VERIFIER, &verifier);

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

    /// Spend up to 2 input notes, create 2 output notes; net token move = ext_amount.
    pub fn transact(
        env: Env,
        proof_bytes: Bytes,
        root: BytesN<32>,
        ext_amount: i128,
        ext_data_hash: BytesN<32>,
        input_nullifiers: Vec<BytesN<32>>,
        output_commitments: Vec<BytesN<32>>,
        account: Address,   // funds source for deposits (requires auth)
        recipient: Address, // funds destination for withdrawals
    ) -> Result<(), PoolError> {
        require_init(&env)?;
        if input_nullifiers.len() != 2 || output_commitments.len() != 2 {
            return Err(PoolError::BadArgs);
        }

        let root_u = to_u256(&env, &root);
        if !is_known_root(&env, &root_u) {
            return Err(PoolError::UnknownRoot);
        }

        let nh0 = input_nullifiers.get(0).unwrap();
        let nh1 = input_nullifiers.get(1).unwrap();
        if nh0 == nh1 {
            return Err(PoolError::DuplicateNullifier);
        }
        if is_spent(&env, &nh0) || is_spent(&env, &nh1) {
            return Err(PoolError::NullifierAlreadySpent);
        }

        let oc0 = output_commitments.get(0).unwrap();
        let oc1 = output_commitments.get(1).unwrap();

        // Build public signals exactly as the circuit ordered them, deriving
        // publicAmount from the token amount we are about to move (binds value).
        let pub_amount = public_amount(&env, ext_amount);
        let mut pub_signals = Bytes::from_array(&env, &7u32.to_be_bytes());
        pub_signals.append(&Bytes::from_array(&env, &root.to_array()));
        pub_signals.append(&Bytes::from_array(&env, &to_bytes32(&env, &pub_amount).to_array()));
        pub_signals.append(&Bytes::from_array(&env, &ext_data_hash.to_array()));
        pub_signals.append(&Bytes::from_array(&env, &nh0.to_array()));
        pub_signals.append(&Bytes::from_array(&env, &nh1.to_array()));
        pub_signals.append(&Bytes::from_array(&env, &oc0.to_array()));
        pub_signals.append(&Bytes::from_array(&env, &oc1.to_array()));

        let verifier: Address = env.storage().instance().get(&VERIFIER).unwrap();
        if !VerifierClient::new(&env, &verifier).verify(&proof_bytes, &pub_signals) {
            return Err(PoolError::InvalidProof);
        }

        // effects
        env.storage().persistent().set(&(symbol_short!("NULL"), nh0.clone()), &true);
        env.storage().persistent().set(&(symbol_short!("NULL"), nh1.clone()), &true);
        let leaf_index = insert_leaf(&env, &to_u256(&env, &oc0))?;
        insert_leaf(&env, &to_u256(&env, &oc1))?;

        // token movement
        let token_addr: Address = env.storage().instance().get(&TOKEN).unwrap();
        let tkn = token::Client::new(&env, &token_addr);
        if ext_amount > 0 {
            account.require_auth();
            tkn.transfer(&account, &env.current_contract_address(), &ext_amount);
        } else if ext_amount < 0 {
            tkn.transfer(&env.current_contract_address(), &recipient, &(-ext_amount));
        }

        env.events().publish(
            (symbol_short!("transact"),),
            TransactEvent {
                ext_amount,
                leaf_index,
                out_commitment_0: oc0,
                out_commitment_1: oc1,
                new_root: to_bytes32(&env, &current_root(&env)),
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    pub fn get_root(env: Env) -> BytesN<32> {
        to_bytes32(&env, &current_root(&env))
    }
    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&COUNT).unwrap_or(0)
    }
    pub fn known_root(env: Env, root: BytesN<32>) -> bool {
        let u = to_u256(&env, &root);
        is_known_root(&env, &u)
    }
    pub fn nullifier_spent(env: Env, nullifier: BytesN<32>) -> bool {
        is_spent(&env, &nullifier)
    }
}

fn require_init(env: &Env) -> Result<(), PoolError> {
    if env.storage().instance().has(&INIT) { Ok(()) } else { Err(PoolError::NotInitialized) }
}
fn is_spent(env: &Env, nh: &BytesN<32>) -> bool {
    env.storage().persistent().has(&(symbol_short!("NULL"), nh.clone()))
}

fn insert_leaf(env: &Env, leaf: &U256) -> Result<u32, PoolError> {
    let next_index: u32 = env.storage().instance().get(&NEXT_IDX).unwrap();
    if next_index >= (1u32 << DEPTH) {
        return Err(PoolError::TreeFull);
    }
    let p = poseidon::params(env);
    let z = poseidon::zeros(env, &p, DEPTH);
    let mut subtrees: Vec<U256> = env.storage().instance().get(&SUBTREES).unwrap();

    let mut ci = next_index;
    let mut cur = leaf.clone();
    for i in 0..DEPTH {
        if ci % 2 == 0 {
            subtrees.set(i, cur.clone());
            let right = z.get(i).unwrap();
            cur = poseidon::hash2(env, &p, &cur, &right);
        } else {
            let left = subtrees.get(i).unwrap();
            cur = poseidon::hash2(env, &p, &left, &cur);
        }
        ci /= 2;
    }
    env.storage().instance().set(&SUBTREES, &subtrees);

    let root_idx: u32 = env.storage().instance().get(&ROOT_IDX).unwrap();
    let new_root_idx = (root_idx + 1) % ROOT_HISTORY;
    let mut roots: Vec<U256> = env.storage().instance().get(&ROOTS).unwrap();
    roots.set(new_root_idx, cur);
    env.storage().instance().set(&ROOTS, &roots);
    env.storage().instance().set(&ROOT_IDX, &new_root_idx);
    env.storage().instance().set(&NEXT_IDX, &(next_index + 1));
    let count: u32 = env.storage().instance().get(&COUNT).unwrap_or(0);
    env.storage().instance().set(&COUNT, &(count + 1));
    Ok(next_index)
}

fn current_root(env: &Env) -> U256 {
    let idx: u32 = env.storage().instance().get(&ROOT_IDX).unwrap_or(0);
    let roots: Vec<U256> = env.storage().instance().get(&ROOTS).unwrap_or_else(|| Vec::new(env));
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
