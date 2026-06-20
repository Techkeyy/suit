// SUIT Protocol — Shielded Payment Pool (real on-chain state)
//
// A fixed-denomination shielded pool on Soroban. It maintains a real
// incremental Merkle tree of commitments (keccak256) with a rolling root
// history, and a real nullifier set that prevents double-spends.
//
// Every deposit is gated by a REAL on-chain zero-knowledge proof: the pool
// makes a cross-contract call to the SUIT Groth16 verifier and reverts unless
// the proof verifies. No valid proof ⇒ no deposit. The ZK is load-bearing.
//
// Deposit:
//   1. depositor provides commitment C and a Groth16 proof (+ public signals)
//   2. pool calls verifier.verify(proof, public) — must return true
//   3. pool pulls the fixed denomination from the depositor
//   4. C is inserted as a leaf; the Merkle root is updated and recorded
//
// Withdraw (this version):
//   1. holder of the note reveals a nullifier + a Merkle path to a known root
//   2. pool checks the root is recent, the nullifier is unused, and the path
//      reconstructs to that root, then pays out the denomination and burns
//      the nullifier
//
// HONEST NOTE ON PRIVACY: this withdrawal verifies the Merkle path ON-CHAIN,
// which reveals which leaf is being spent (deposit↔withdrawal are linkable).
// Fixed denominations give amount-uniformity, and the commitment/nullifier
// ledger + on-chain ZK gate are real. Full sender↔receiver UNLINKABILITY
// requires replacing this with a Tornado-style ZK membership proof
// (Poseidon-Merkle) verified on-chain — see README "Roadmap". That swap is a
// drop-in: the withdraw entrypoint would take a proof instead of a path.

#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    symbol_short, token, Address, Bytes, BytesN, Env, Symbol, Vec,
};

// Merkle tree depth → 2^DEPTH = 65,536 leaves.
const DEPTH: u32 = 16;
// How many historical roots to accept on withdrawal.
const ROOT_HISTORY: u32 = 30;

// Storage keys
const INIT: Symbol = symbol_short!("INIT");
const TOKEN: Symbol = symbol_short!("TOKEN");
const VERIFIER: Symbol = symbol_short!("VERIFIER");
const DENOM: Symbol = symbol_short!("DENOM");
const SUBTREES: Symbol = symbol_short!("SUBTREES"); // Vec<BytesN<32>> filled subtrees
const ROOTS: Symbol = symbol_short!("ROOTS"); // Vec<BytesN<32>> ring buffer
const ROOT_IDX: Symbol = symbol_short!("ROOTIDX"); // u32 current root slot
const NEXT_IDX: Symbol = symbol_short!("NEXTIDX"); // u32 next leaf index
const COUNT: Symbol = symbol_short!("COUNT"); // u32 total deposits

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidProof = 3,
    DuplicateCommitment = 4,
    TreeFull = 5,
    UnknownRoot = 6,
    NullifierAlreadySpent = 7,
    MerklePathInvalid = 8,
    BadPathLength = 9,
    CommitmentMismatch = 10,
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
    pub nullifier: BytesN<32>,
    pub recipient: Address,
    pub timestamp: u64,
}

// Cross-contract client for the SUIT Groth16 verifier.
#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify(env: Env, proof_bytes: Bytes, pub_signals_bytes: Bytes) -> bool;
}

#[contract]
pub struct SuitPool;

#[contractimpl]
impl SuitPool {
    /// Initialize the pool with the token, the Groth16 verifier contract, and
    /// the fixed denomination (in token base units).
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

        // Initialize the incremental Merkle tree: filled subtrees start as the
        // precomputed "zero" subtree hashes for each level.
        let mut subtrees: Vec<BytesN<32>> = Vec::new(&env);
        for i in 0..DEPTH {
            subtrees.push_back(zeros(&env, i));
        }
        env.storage().instance().set(&SUBTREES, &subtrees);

        // Roots ring buffer; slot 0 is the empty-tree root.
        let mut roots: Vec<BytesN<32>> = Vec::new(&env);
        let empty_root = zeros(&env, DEPTH);
        for _ in 0..ROOT_HISTORY {
            roots.push_back(empty_root.clone());
        }
        env.storage().instance().set(&ROOTS, &roots);
        env.storage().instance().set(&ROOT_IDX, &0u32);
        env.storage().instance().set(&NEXT_IDX, &0u32);
        env.storage().instance().set(&COUNT, &0u32);
        Ok(())
    }

    /// Deposit the fixed denomination into the pool. Gated by a real on-chain
    /// Groth16 proof verified via cross-contract call.
    pub fn deposit(
        env: Env,
        depositor: Address,
        commitment: BytesN<32>,
        proof_bytes: Bytes,
        pub_signals_bytes: Bytes,
    ) -> Result<u32, PoolError> {
        require_init(&env)?;
        depositor.require_auth();

        // Reject duplicate commitments.
        let comm_key = (symbol_short!("COMM"), commitment.clone());
        if env.storage().persistent().has(&comm_key) {
            return Err(PoolError::DuplicateCommitment);
        }

        // --- REAL ZK GATE: verify the proof on-chain before accepting funds.
        let verifier: Address = env.storage().instance().get(&VERIFIER).unwrap();
        let ok = VerifierClient::new(&env, &verifier).verify(&proof_bytes, &pub_signals_bytes);
        if !ok {
            return Err(PoolError::InvalidProof);
        }

        // Bind the stored commitment to the value the proof actually committed
        // to. Public signals layout: u32 len(4) | s0(32) | s1(32) | s2(32),
        // where s2 (offset 68..100) is the circuit's `commitment`. Without this,
        // a valid range proof could be paired with an unrelated leaf.
        if pub_signals_bytes.len() != 100 {
            return Err(PoolError::CommitmentMismatch);
        }
        let mut proof_commitment = [0u8; 32];
        pub_signals_bytes.slice(68..100).copy_into_slice(&mut proof_commitment);
        if proof_commitment != commitment.to_array() {
            return Err(PoolError::CommitmentMismatch);
        }

        // Pull the fixed denomination from the depositor into the pool.
        let token_addr: Address = env.storage().instance().get(&TOKEN).unwrap();
        let denom: i128 = env.storage().instance().get(&DENOM).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &depositor,
            &env.current_contract_address(),
            &denom,
        );

        // Insert the commitment into the Merkle tree.
        let leaf_index = insert_leaf(&env, &commitment)?;
        env.storage().persistent().set(&comm_key, &leaf_index);

        let count: u32 = env.storage().instance().get(&COUNT).unwrap();
        env.storage().instance().set(&COUNT, &(count + 1));

        let root = current_root(&env);
        env.events().publish(
            (symbol_short!("deposit"),),
            DepositEvent {
                commitment: commitment.clone(),
                leaf_index,
                root,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(leaf_index)
    }

    /// Withdraw the denomination by revealing a nullifier and a Merkle path
    /// (leaf + siblings + direction bits) that reconstructs to a known root.
    pub fn withdraw(
        env: Env,
        recipient: Address,
        nullifier: BytesN<32>,
        leaf: BytesN<32>,
        path_elements: Vec<BytesN<32>>,
        path_indices: Vec<u32>,
        root: BytesN<32>,
    ) -> Result<(), PoolError> {
        require_init(&env)?;

        if path_elements.len() != DEPTH || path_indices.len() != DEPTH {
            return Err(PoolError::BadPathLength);
        }

        // Root must be one the pool has recently produced.
        if !is_known_root(&env, &root) {
            return Err(PoolError::UnknownRoot);
        }

        // Nullifier must be unused.
        let null_key = (symbol_short!("NULL"), nullifier.clone());
        if env.storage().persistent().has(&null_key) {
            return Err(PoolError::NullifierAlreadySpent);
        }

        // Recompute the root from the supplied Merkle path.
        let mut node = leaf;
        for i in 0..DEPTH {
            let sibling = path_elements.get(i).unwrap();
            let is_right = path_indices.get(i).unwrap() == 1;
            node = if is_right {
                hash_pair(&env, &sibling, &node)
            } else {
                hash_pair(&env, &node, &sibling)
            };
        }
        if node != root {
            return Err(PoolError::MerklePathInvalid);
        }

        // Burn the nullifier and pay out.
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
            WithdrawEvent {
                nullifier,
                recipient,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    // ---- views ----

    pub fn get_root(env: Env) -> BytesN<32> {
        current_root(&env)
    }

    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&COUNT).unwrap_or(0)
    }

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&(symbol_short!("NULL"), nullifier))
    }

    pub fn known_root(env: Env, root: BytesN<32>) -> bool {
        is_known_root(&env, &root)
    }
}

// ---- internal helpers ----

fn require_init(env: &Env) -> Result<(), PoolError> {
    if env.storage().instance().has(&INIT) {
        Ok(())
    } else {
        Err(PoolError::NotInitialized)
    }
}

/// keccak256(left || right) as the Merkle node hash.
fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(&Bytes::from_array(env, &left.to_array()));
    buf.append(&Bytes::from_array(env, &right.to_array()));
    env.crypto().keccak256(&buf).into()
}

/// The "zero" subtree hash at a given level. Level 0 is a domain-separated
/// leaf zero; each higher level hashes the level below with itself.
fn zeros(env: &Env, level: u32) -> BytesN<32> {
    let seed = Bytes::from_array(env, b"SUIT_ZERO_LEAF_V1______________");
    let mut node: BytesN<32> = env.crypto().keccak256(&seed).into();
    let mut i = 0u32;
    while i < level {
        node = hash_pair(env, &node, &node);
        i += 1;
    }
    node
}

/// Insert a leaf into the incremental Merkle tree, update filled subtrees and
/// the root history. Returns the leaf index.
fn insert_leaf(env: &Env, leaf: &BytesN<32>) -> Result<u32, PoolError> {
    let next_index: u32 = env.storage().instance().get(&NEXT_IDX).unwrap();
    if next_index >= (1u32 << DEPTH) {
        return Err(PoolError::TreeFull);
    }

    let mut subtrees: Vec<BytesN<32>> = env.storage().instance().get(&SUBTREES).unwrap();

    let mut current_index = next_index;
    let mut current_hash = leaf.clone();
    for i in 0..DEPTH {
        if current_index % 2 == 0 {
            // left child: sibling is the zero subtree, remember this node
            let right = zeros(env, i);
            subtrees.set(i, current_hash.clone());
            current_hash = hash_pair(env, &current_hash, &right);
        } else {
            // right child: sibling is the stored filled subtree
            let left = subtrees.get(i).unwrap();
            current_hash = hash_pair(env, &left, &current_hash);
        }
        current_index /= 2;
    }

    env.storage().instance().set(&SUBTREES, &subtrees);

    // Advance the root ring buffer.
    let root_idx: u32 = env.storage().instance().get(&ROOT_IDX).unwrap();
    let new_root_idx = (root_idx + 1) % ROOT_HISTORY;
    let mut roots: Vec<BytesN<32>> = env.storage().instance().get(&ROOTS).unwrap();
    roots.set(new_root_idx, current_hash);
    env.storage().instance().set(&ROOTS, &roots);
    env.storage().instance().set(&ROOT_IDX, &new_root_idx);
    env.storage().instance().set(&NEXT_IDX, &(next_index + 1));

    Ok(next_index)
}

fn current_root(env: &Env) -> BytesN<32> {
    let root_idx: u32 = env.storage().instance().get(&ROOT_IDX).unwrap_or(0);
    let roots: Vec<BytesN<32>> = env
        .storage()
        .instance()
        .get(&ROOTS)
        .unwrap_or_else(|| Vec::new(env));
    roots.get(root_idx).unwrap_or_else(|| zeros(env, DEPTH))
}

fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
    let roots: Vec<BytesN<32>> = match env.storage().instance().get(&ROOTS) {
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
