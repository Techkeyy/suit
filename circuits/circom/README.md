# Circuits (Circom)

This directory contains the Circom implementation of the SUIT range proof circuit.

What this circuit proves
- It proves that a hidden `amount` lies within the inclusive range `[min_amount, max_amount]` without revealing `amount` itself.

Constraints
1. amount >= min_amount — enforced by computing `diff_low = amount - min_amount` and proving `diff_low` fits in 64 bits via `Num2Bits(64)`.
2. max_amount >= amount — enforced by computing `diff_high = max_amount - amount` and proving `diff_high` fits in 64 bits via `Num2Bits(64)`.
3. commitment === amount + secret — ensures the provided public `commitment` binds to the private `amount` and `secret`.

File structure
- `RangeProof.circom` — Circom 2.0 circuit implementing the range proof.
- `package.json` — helper npm scripts and dependency hints (circomlib, snarkjs).
- `build/` — output directory for compiled artifacts (r1cs, wasm, zkey, etc.).

Usage
1. Install dependencies (do not run here):

```bash
npm install
```

2. Compile the circuit:

```bash
npm run compile
```

3. Setup ceremony / parameters (example, using `snarkjs`):

```bash
npm run setup
```

4. Generate witness and produce a proof:

```bash
npm run prove
```

5. Verify the proof locally:

```bash
npm run verify-local
```

Technical notes
- The circuit uses 64-bit width checks via `Num2Bits(64)` for the difference values to ensure non-negativity and bounds.
- Intended for Groth16 proofs on BN254 (as commonly used with `snarkjs`).
- The `commitment` relation is shown here as a simple additive relation (`amount + secret`). In production, a proper Pedersen commitment should be used.
