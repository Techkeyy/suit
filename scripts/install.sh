#!/bin/bash
# SUIT Protocol — Install all dependencies
# Run this first before anything else

set -e

echo "======================================"
echo "  SUIT Protocol — Installing deps"
echo "======================================"

# Check required tools
echo ""
echo "Checking required tools..."

check_tool() {
  if ! command -v "$1" &> /dev/null; then
    echo "  MISSING: $1 — $2"
    MISSING=1
  else
    echo "  OK: $1"
  fi
}

MISSING=0
check_tool "node" "Install from https://nodejs.org"
check_tool "npm" "Comes with Node.js"
check_tool "cargo" "Install from https://rustup.rs"
check_tool "stellar" "Install from https://github.com/stellar/stellar-cli"
check_tool "circom" "Run: npm install -g circom"
check_tool "nargo" "Run: noirup (https://noir-lang.org/docs)"

if [ "$MISSING" = "1" ]; then
  echo ""
  echo "Please install missing tools above, then re-run this script."
  exit 1
fi

echo ""
echo "All tools found."

# Install Circom circuit dependencies
echo ""
echo "Installing Circom dependencies..."
cd "$(dirname "$0")/../circuits/circom"
npm install
echo "  Circom deps installed."

# Install SDK dependencies
echo ""
echo "Installing SDK dependencies..."
cd "$(dirname "$0")/../sdk"
npm install
echo "  SDK deps installed."

# Install app dependencies
echo ""
echo "Installing app dependencies..."
cd "$(dirname "$0")/../app"
if [ -f "package.json" ]; then
  npm install
  echo "  App deps installed."
else
  echo "  App package.json not found — skipping."
fi

# Add Soroban WASM target
echo ""
echo "Adding Rust WASM target for Soroban..."
rustup target add wasm32-unknown-unknown
echo "  WASM target added."

echo ""
echo "======================================"
echo "  Installation complete."
echo "  Next: run scripts/setup_circuits.sh"
echo "======================================"
