# SUIT — Shielded Payment Pool Contract

## What this contract does
This Soroban contract is the core of the SUIT protocol.
It manages the shielded payment pool — a shared on-chain pool
where senders deposit and receivers withdraw without any
on-chain link between the two operations.

## Key concepts
- **Commitments**: cryptographic hashes stored on-chain representing deposits
- **Nullifiers**: one-time values that prevent double-spending on withdrawal
- **Merkle tree**: structure holding all commitments — receiver proves membership
- **ZK proofs**: three proof types verified before any deposit is accepted

## Functions
- `initialize(token, groth16_verifier, ultrahonk_verifier, risc0_verifier)`
- `deposit(sender, commitment, amount, range_proof, kyc_proof, compliance_receipt)`
- `withdraw(recipient, nullifier, merkle_proof, commitment_index, amount)`
- `get_root()` — current Merkle root
- `get_count()` — total commitments in pool
- `is_spent(nullifier)` — check if nullifier used

## Requirements
- Rust + Soroban SDK 21.0.0
- stellar-cli

## Build
```bash
cd Desktop/suit/contracts/pool
cargo build --target wasm32-unknown-unknown --release
```
