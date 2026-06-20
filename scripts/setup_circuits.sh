#!/bin/bash
# SUIT Protocol — Compile Circom circuit and run trusted setup
# Run after install.sh

set -e

echo "======================================"
echo "  SUIT Protocol — Circuit Setup"
echo "======================================"

CIRCOM_DIR="$(dirname "$0")/../circuits/circom"
BUILD_DIR="$CIRCOM_DIR/build"

mkdir -p "$BUILD_DIR"

# Step 1: Compile the Circom circuit
echo ""
echo "Step 1: Compiling RangeProof.circom..."
cd "$CIRCOM_DIR"
circom RangeProof.circom --r1cs --wasm --sym --output "$BUILD_DIR"
echo "  Compiled: build/RangeProof.r1cs"
echo "  Compiled: build/RangeProof_js/RangeProof.wasm"

# Step 2: Run trusted setup (Powers of Tau + Groth16)
echo ""
echo "Step 2: Running trusted setup (this takes ~30 seconds)..."
node scripts/setup.js
echo "  Setup complete: build/verification_key.json"

# Step 3: Generate a test proof
echo ""
echo "Step 3: Generating test proof..."
node scripts/prove.js
echo "  Proof generated: build/proof.json"

# Step 4: Verify proof locally
echo ""
echo "Step 4: Verifying proof locally..."
node scripts/verify_local.js

echo ""
echo "======================================"
echo "  Circuit setup complete."
echo "  Verification key: circuits/circom/build/verification_key.json"
echo "  Next: run scripts/deploy_contracts.sh"
echo "======================================"
