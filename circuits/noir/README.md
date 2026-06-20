# SUIT — Noir KYC Identity Circuit

## What this proves
Given a private KYC credential, this circuit proves:
1. The credential nullifier is correctly derived from the credential (prevents reuse)
2. The credential was issued by a trusted issuer (commitment check)
3. The credential grants a KYC level that meets the pool policy minimum

No personal data, no credential contents, no identity is ever revealed on-chain.

## Files
- `src/main.nr` — the Noir circuit
- `Nargo.toml` — Noir package config
- `Prover.toml` — test inputs for local proving
- `target/` — compiled output (generated, do not commit)

## Requirements
- Nargo (Noir toolchain): https://noir-lang.org/docs/
- bb (Barretenberg backend): https://github.com/AztecProtocol/aztec-packages

## Usage
```bash
# Install Nargo
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup

# Compile circuit
nargo compile

# Generate test proof
nargo prove

# Verify proof locally
nargo verify

# For Stellar deployment — generate UltraHonk proof via bb.js
# See scripts/noir_prove.js (created in next step)
```

## KYC Levels
- 0 = Basic (email verified)
- 1 = Full KYC (identity verified)
- 2 = Institutional (accredited investor / entity verified)

## Integration
The nullifier is stored on-chain in the pool contract to prevent
credential reuse. The issuer_commitment is checked against a
registry of approved issuers in the pool policy.
