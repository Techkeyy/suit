# SUIT — Shielded Universal Payment Protocol

**Private by default. Auditable by choice. Built on Stellar.**

SUIT is a shielded payment pool on Stellar where **every deposit is gated by a
real zero-knowledge proof verified on-chain**. The amount a depositor commits to
is proven to satisfy a compliance policy (a value range) *without the amount
appearing in the proof*, and the proof is checked inside a Soroban smart
contract using Stellar's native **BLS12-381 pairing** host functions.

This repository is deliberately **narrow and deep**: rather than name-checking
six ZK use cases with stubbed verifiers, it implements **one** ZK system
end-to-end and makes it genuinely load-bearing — a Circom/Groth16 proof that is
verified on Stellar testnet and that a real privacy pool depends on.

> The ZK is load-bearing: no valid proof ⇒ no deposit. The verifier performs a
> genuine pairing check — it accepts real proofs and rejects forged ones. This
> is demonstrated by an automated test (`accepts_valid_proof`,
> `rejects_tampered_public_signals`) and live on testnet.

## Live on Stellar testnet

| Contract | ID |
|---|---|
| Groth16 verifier | [`CA2W26LB…KAWIV`](https://stellar.expert/explorer/testnet/contract/CA2W26LBXZ7FZWKKPW4NHTO52AUYWBAT47S2QMMDDEWORFG4RYQKAWIV) |
| Shielded pool | [`CBFZAM2F…WZUG`](https://stellar.expert/explorer/testnet/contract/CBFZAM2F5MP62XG3LP75HD4STKZOAWDX45HEJ6QXVCNFFXTT2H2HWZUG) |
| Token (native XLM SAC) | `CDLZFC3S…CYSC` |

The full cycle below was executed live on testnet (links open the actual
transactions):

| Step | Outcome | Tx |
|---|---|---|
| `verify` a real proof | `true` | (read-only) |
| `verify` with one bit flipped in public signals | `false` | (read-only) |
| **Deposit** (gated by on-chain proof) — 100 XLM in, commitment inserted | success | [tx](https://stellar.expert/explorer/testnet/tx/0461e9210b6cc4b07c07015171893a1b3c7cf1b52fbd8de34b9f88219e2beeac) |
| **Deposit with a forged proof** | reverts `Error(#3) InvalidProof` — no funds move | — |
| **Withdraw** (Merkle path + nullifier) — 100 XLM out to a different account | success | [tx](https://stellar.expert/explorer/testnet/tx/d6f78d0c6b15e16294ebbe05154150641c2629c4ea6b66cc42aae84079a2bd9c) |
| **Double-spend** the same nullifier | reverts `Error(#7) NullifierAlreadySpent` | — |

The forged-proof deposit is the clearest evidence the ZK is load-bearing: the
pool makes a cross-contract call to `verify`, the on-chain BLS12-381 pairing
check returns `false`, and the whole deposit transaction reverts.

```
# real proof
$ stellar contract invoke --id <verifier> -- verify --proof_bytes <p> --pub_signals_bytes <s>
true
# same proof, public signals tampered
false
```

All IDs and demo tx hashes are in [`scripts/deployed.env`](scripts/deployed.env).

---

## What actually works (and what doesn't)

We follow the hackathon's honesty rule. Here is the precise status of every
component.

| Component | Status |
|---|---|
| Circom range-proof circuit over **BLS12-381** | ✅ Real. Compiled, trusted setup done, proof generated & verified. |
| `circom-to-soroban-hex` converter (snarkjs JSON → Soroban bytes) | ✅ Real. Encoding matched 1:1 with the contract parser. |
| **Groth16 verifier contract** (real BLS12-381 pairing check) | ✅ Real. Unit-tested (accepts valid / rejects forged) and deployed to testnet. |
| **Pool contract** — incremental Merkle tree (keccak256), root history, nullifier set, ZK-gated deposit | ✅ Real on-chain state machine. Unit-tested deposit→withdraw cycle. |
| Deposit gated by on-chain proof (cross-contract `verify`) | ✅ Real. |
| Withdrawal with nullifier double-spend prevention | ✅ Real. |
| **Full sender↔receiver unlinkability** (Tornado-style ZK membership proof) | 🚧 Roadmap — see [Privacy model](#privacy-model-honest). |
| Noir KYC identity circuit | 🚧 Roadmap circuit present in `circuits/noir/`, no deployed verifier. |
| RISC Zero compliance | ❌ Cut from scope for this submission. |

---

## Privacy model (honest)

A real privacy pool has two ZK-relevant moments: the **deposit** (prove the
deposited note is well-formed / policy-compliant) and the **withdrawal** (prove
you own *some* note in the pool without revealing *which*, i.e.
unlinkability).

**This submission implements the deposit-side ZK fully and on-chain.** Deposits
use a fixed denomination (amount uniformity) and are gated by a real Groth16
proof. The pool keeps only commitments — never plaintext amounts — in a real
Merkle tree, with a real nullifier set preventing double-spends.

**The withdrawal in this version verifies a Merkle path on-chain**, which
reveals which leaf is being spent. That means deposit and withdrawal are
*linkable* today. Full unlinkability requires replacing the on-chain Merkle
check with a **Tornado-style ZK membership proof** (prove knowledge of a leaf
in the tree + a nullifier, all in-circuit). We scoped that as roadmap rather
than ship it half-working, because it needs a **circom-compatible Poseidon
Merkle tree on-chain**, and Stellar currently exposes Poseidon only as a
low-level *permutation* primitive (CAP-0075, `hazmat-crypto`) rather than a
drop-in circomlib-compatible hash. Closing that gap is the single most
interesting next step and the `withdraw` entrypoint is structured as a drop-in
swap (path → proof).

We would rather show you exactly where the frontier is than hide a stub behind
a confident README.

---

## Architecture

```
                      off-chain (client)                     on-chain (Soroban / Stellar testnet)
  ┌───────────────────────────────────────────┐      ┌──────────────────────────────────────────┐
  │ amount, secret  ──► Circom RangeProof      │      │  Groth16 verifier contract                 │
  │   (BLS12-381)        ├─ proof.json         │      │   verify(proof, public) → bool             │
  │                      └─ public_signals.json │      │   (real BLS12-381 pairing_check)           │
  │ circom-to-soroban-hex ──► proof/public/vk  │─────►│                                            │
  │                          (Soroban bytes)    │      │  Pool contract                             │
  │ commitment = f(amount, secret)              │      │   deposit(commitment, proof, public):      │
  └───────────────────────────────────────────┘      │     ├─ cross-contract verify(...) == true   │
                                                       │     ├─ pull fixed denomination (token)      │
                                                       │     └─ insert leaf into Merkle tree         │
                                                       │   withdraw(nullifier, path, root):          │
                                                       │     ├─ root known? nullifier unused?        │
                                                       │     ├─ Merkle path reconstructs root?       │
                                                       │     └─ pay out + burn nullifier             │
                                                       └──────────────────────────────────────────┘
```

The verification key, proof, and public signals are encoded with arkworks
`serialize_uncompressed` (G1 = 96 bytes, G2 = 192 bytes) and parsed back inside
the contract with `G1Affine::from_array` / `G2Affine::from_array` — the encoding
is the contract's source of truth and is covered by tests.

---

## Repository layout

```
suit/
├── circuits/
│   ├── circom/            # RangeProof circuit (BLS12-381) + setup/prove scripts
│   └── noir/              # KYC identity circuit (roadmap, not deployed)
├── contracts/
│   ├── groth16_verifier/  # REAL BLS12-381 Groth16 verifier (+ tests)
│   └── pool/              # Shielded pool: Merkle tree, nullifiers, ZK-gated deposit (+ tests)
├── tools/
│   └── circom_to_soroban_hex/   # snarkjs JSON → Soroban byte payloads
├── sdk/                   # TypeScript SDK
├── app/                   # React demo frontend
├── scripts/              # build / deploy / e2e
└── README.md
```

---

## Reproduce it end-to-end

Prereqs: Node, Rust, the `wasm32-unknown-unknown` target, the `stellar` CLI, and
`circom` 2.x.

```bash
# 1. Compile the circuit over BLS12-381 + trusted setup + a proof
cd circuits/circom
npm install
npm run compile                 # circom --prime bls12381
node scripts/setup.js           # powers of tau + zkey + verification_key.json
node scripts/prove.js           # proof.json + public_signals.json
node scripts/verify_local.js    # snarkjs sanity check (should print VALID)

# 2. Convert snarkjs JSON → Soroban byte payloads
cd ../../tools/circom_to_soroban_hex && cargo build --release
BIN=target/release/circom-to-soroban-hex
$BIN vk     ../../circuits/circom/build/verification_key.json > ../../circuits/circom/build/vk.hex
$BIN proof  ../../circuits/circom/build/proof.json            > ../../circuits/circom/build/proof.hex
$BIN public ../../circuits/circom/build/public_signals.json   > ../../circuits/circom/build/public.hex

# 3. Test the real verifier + pool (host tests — real pairing checks)
cd ../../contracts/groth16_verifier && cargo test
cd ../pool && cargo test

# 4. Deploy + wire on testnet, then run the live flow
cd ../.. && ./scripts/deploy_contracts.sh
node scripts/e2e_test.js
```

---

## Why this is a strong ZK-on-Stellar submission

- **The ZK is load-bearing and real.** A genuine Groth16 pairing check runs in a
  Soroban contract; the pool cannot accept a deposit without it. Not mocked, not
  simulated — verified on testnet, with a test that proves forged proofs are
  rejected.
- **It uses Stellar's new ZK primitives** (BLS12-381 pairing host functions) for
  exactly what they were built for: cheap on-chain SNARK verification.
- **It is honest.** Every simplification and every roadmap item is labeled.

## License

MIT.
