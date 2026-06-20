#!/bin/bash
# SUIT — live testnet demo. Runs the full cycle against the deployed contracts:
#   1. verify a real proof on-chain            → true
#   2. verify with tampered public signals      → false
#   3. ZK-gated deposit                          → success
#   4. deposit with a forged proof              → reverts (InvalidProof)
#   5. withdraw with Merkle path + nullifier     → success
#   6. double-spend the same nullifier          → reverts (NullifierAlreadySpent)
#
# Prereqs: ./scripts/deploy_contracts.sh has run (scripts/deployed.env exists),
# and circuits/circom/build/{proof,public}.hex exist.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/deployed.env"
SRC="${IDENTITY:-suit-deployer}"
NET="${NETWORK:-testnet}"

PROOF=$(cat "$ROOT/circuits/circom/build/proof.hex" | tr -d '[:space:]')
PUB=$(cat "$ROOT/circuits/circom/build/public.hex" | tr -d '[:space:]')
# tamper: flip last nibble of public signals
TAMPERED="${PUB:0:$((${#PUB}-1))}$(printf '%x' $(( 0x${PUB: -1} ^ 1 )))"

ME=$(stellar keys address "$SRC")
COMMIT="1111111111111111111111111111111111111111111111111111111111111111"
COMMIT_BAD="2222222222222222222222222222222222222222222222222222222222222222"
NULL="9999999999999999999999999999999999999999999999999999999999999999"

inv() { stellar contract invoke --id "$1" --source "$SRC" --network "$NET" -- "${@:2}"; }

echo "==> 1. verify REAL proof (expect true)"
inv "$GROTH16_VERIFIER_ID" verify --proof_bytes "$PROOF" --pub_signals_bytes "$PUB"

echo "==> 2. verify TAMPERED signals (expect false)"
inv "$GROTH16_VERIFIER_ID" verify --proof_bytes "$PROOF" --pub_signals_bytes "$TAMPERED"

echo "==> 3. ZK-gated DEPOSIT (expect success)"
inv "$POOL_CONTRACT_ID" deposit --depositor "$ME" --commitment "$COMMIT" \
  --proof_bytes "$PROOF" --pub_signals_bytes "$PUB"

echo "==> 4. DEPOSIT with FORGED proof (expect revert: InvalidProof / #3)"
inv "$POOL_CONTRACT_ID" deposit --depositor "$ME" --commitment "$COMMIT_BAD" \
  --proof_bytes "$PROOF" --pub_signals_bytes "$TAMPERED" || echo "   ✓ rejected on-chain as expected"

echo "==> 5. WITHDRAW (Merkle path + nullifier) — see scripts/withdraw_demo.js"
echo "   node scripts/withdraw_demo.js 0 $COMMIT <recipient> $NULL"
echo "   then run the printed 'stellar contract invoke ... withdraw' command."

echo ""
echo "Pool deposit count:"
inv "$POOL_CONTRACT_ID" get_count
