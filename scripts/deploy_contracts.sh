#!/bin/bash
# SUIT Protocol — Build, deploy and wire the Soroban contracts on testnet.
#
# Deploys the two real contracts:
#   - suit-groth16-verifier  (real BLS12-381 Groth16 pairing verifier)
#   - suit-pool              (shielded commitment pool, ZK-gated deposits)
#
# Then initializes the verifier with the circuit's verification key and the
# pool with the token + verifier + denomination.
#
# Prereqs: stellar CLI, the wasm target, and a funded testnet identity.
#   circuits regenerated over BLS12-381 (npm run compile && node scripts/setup.js)
#   vk hex produced via tools/circom_to_soroban_hex.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-suit-deployer}"
DENOMINATION="${DENOMINATION:-1000000000}" # 100 units @ 7 decimals
# Native XLM SAC on testnet, or override with a token contract id.
TOKEN_ID="${TOKEN_ID:-}"

echo "======================================"
echo "  SUIT Protocol — Deploy ($NETWORK)"
echo "======================================"

# --- identity ---
if ! stellar keys ls 2>/dev/null | grep -q "$IDENTITY"; then
  echo "Creating identity $IDENTITY..."
  stellar keys generate --global "$IDENTITY" --network "$NETWORK" --fund
fi
DEPLOYER_ADDR=$(stellar keys address "$IDENTITY")
echo "Deployer: $DEPLOYER_ADDR"

# Default token: wrapped native XLM SAC.
if [ -z "$TOKEN_ID" ]; then
  echo "No TOKEN_ID set — using native XLM SAC."
  TOKEN_ID=$(stellar contract id asset --asset native --network "$NETWORK")
fi
echo "Token: $TOKEN_ID"

build() {
  local NAME=$1 DIR=$2
  echo "Building $NAME..."
  (cd "$DIR" && stellar contract build 2>&1 | tail -2)
  echo "$DIR/target/wasm32v1-none/release/$(echo "$NAME" | tr '-' '_').wasm"
}

deploy() {
  local WASM=$1
  stellar contract deploy --wasm "$WASM" --source "$IDENTITY" --network "$NETWORK"
}

# --- Groth16 verifier ---
echo ""
echo "--- Groth16 verifier ---"
G16_WASM=$(build "suit-groth16-verifier" "$ROOT/contracts/groth16_verifier")
GROTH16_ID=$(deploy "$G16_WASM")
echo "  deployed: $GROTH16_ID"

# --- Pool ---
echo ""
echo "--- Pool ---"
POOL_WASM=$(build "suit-pool" "$ROOT/contracts/pool")
POOL_ID=$(deploy "$POOL_WASM")
echo "  deployed: $POOL_ID"

# --- Initialize verifier with the verification key ---
echo ""
echo "Setting verification key on the verifier..."
VK_HEX=$(cat "$ROOT/circuits/circom/build/vk.hex")
stellar contract invoke \
  --id "$GROTH16_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- set_vk --vk_bytes "$VK_HEX"

# --- Initialize the pool ---
echo "Initializing pool..."
stellar contract invoke \
  --id "$POOL_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- initialize \
  --token "$TOKEN_ID" \
  --verifier "$GROTH16_ID" \
  --denomination "$DENOMINATION"

# --- Persist deployment ---
cat > "$ROOT/scripts/deployed.env" << EOF
# SUIT — deployed contract IDs ($NETWORK, $(date))
NETWORK=$NETWORK
DEPLOYER=$DEPLOYER_ADDR
TOKEN_ID=$TOKEN_ID
GROTH16_VERIFIER_ID=$GROTH16_ID
POOL_CONTRACT_ID=$POOL_ID
DENOMINATION=$DENOMINATION
EOF

echo ""
echo "======================================"
echo "  Done."
echo "  Verifier: $GROTH16_ID"
echo "  Pool:     $POOL_ID"
echo "  Saved to scripts/deployed.env"
echo "======================================"
