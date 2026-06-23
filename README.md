# SUIT — Shielded Universal Payment Protocol

**Arbitrary-amount unlinkable payments on Stellar, verified by zero-knowledge.**

SUIT is a shielded UTXO pool on Stellar. Deposit **any amount**, then withdraw
**any portion** to any address by submitting a zero-knowledge proof of value
conservation — **without revealing which deposit was yours or how much you moved.**
Change is returned as a new shielded note. An observer sees a deposit and an
unrelated withdrawal, and cannot link them.

This is a **Tornado-Nova–class** design: a 2-in/2-out UTXO transaction circuit
(Groth16 over BN254, 22.8k constraints) generated **in your browser** with
snarkjs and verified **on-chain** inside a Soroban contract using Stellar's BN254
pairing host functions. No valid proof → no withdrawal.

> Arbitrary amounts. Full privacy. Proven end-to-end on Stellar testnet.

---

## Live on Stellar testnet

| Contract | ID |
|---|---|
| Pool — XLM (arbitrary-amount UTXO) | [`CDGGJTTW…PPX6X`](https://stellar.expert/explorer/testnet/contract/CDGGJTTWSOGHKO6GCZTZQUIO4U2Y5PUQOSAWESGUUC74QUXDHGIPPX6X) |
| Pool — USDC (arbitrary-amount UTXO) | [`CARK2WXV…D4GS`](https://stellar.expert/explorer/testnet/contract/CARK2WXVBDREA3ARTCGCRHHDXDG4YXSZSU52QIL6BPVPRBV6TTJXD4GS) |
| BN254 Groth16 verifier (TX circuit) | [`CDEZRSL6…KON2T`](https://stellar.expert/explorer/testnet/contract/CDEZRSL6WXBEJZ45WVFDI6DIHJEZ6UEWY3CUJIQPLCQIVUMLXXVKON2T) |
| Asset contracts (SACs) | XLM `CDLZFC3S…CYSC` · test-USDC `CDCFQVDH…MASU` |

**App: https://suit-app.vercel.app** (requires the Freighter wallet on testnet).

---

## How it works

```
  shield (deposit any amount)              withdraw (any portion, unlinkable)
  ───────────────────────────              ────────────────────────────────────
  note = (amount, privKey, blinding)       prove in-browser (snarkjs):
  commitment = Poseidon(amount,              • input notes ∈ Merkle tree
               pubKey, blinding)             • value conservation:
  any XLM amount ──► pool.transact()           sum(inputs) + publicAmount = sum(outputs)
                     inserts commitment        • nullifiers prevent double-spend
                     into on-chain             • change returned as new note
                     Poseidon Merkle tree    Groth16 (BN254) proof
                                               │
                     pool.transact(proof, root, ext_amount, nullifiers, commitments)
                                               │  BN254 pairing check on-chain
                                               ▼
                     pays recipient · burns nullifiers · reveals NOT which note or amount
```

**Value conservation is proven inside the ZK proof**: the circuit enforces that
input amounts + public amount = output amounts (mod BN254 scalar field). The
chain verifies the proof but never sees any amounts — only commitments and
nullifiers.

The Poseidon hash is **byte-identical** across all three environments: the
circuit (circomlib BN254), the browser (poseidon-lite), and the contract
(Stellar's host `poseidon_permutation` fed circomlib's exact t=3 constants).
That equality is what lets an in-browser proof verify against the on-chain tree.

---

## Architecture

### Transaction circuit (`circuits/circom/Transaction.circom`)

A 2-in/2-out UTXO transaction circuit (Tornado-Nova model):

- **Inputs**: 2 existing notes (or dummy zero-amount notes for deposits)
- **Outputs**: 2 new notes (the actual output + change/zero)
- **Public signals**: root, publicAmount, extDataHash, 2 input nullifiers, 2 output commitments
- **Key constraints**:
  - Merkle membership proof for each non-zero input (depth-16 Poseidon tree)
  - Nullifier = Poseidon(commitment, pathIndex, signature) where signature = Poseidon(privKey, commitment, pathIndex)
  - Value conservation: `sum(inAmounts) + publicAmount === sum(outAmounts)`
  - Range proofs (Num2Bits 248) to prevent overflow
  - ForceEqualIfEnabled gates: root/nullifier checks disabled for zero-amount dummy inputs
- **~22,800 constraints** · Groth16 · BN254 · Hermez community ptau (2^15)

### Pool v3 contract (`contracts/pool_v3/`)

Single `transact()` entrypoint for deposits, withdrawals, and transfers:

- `ext_amount > 0` → deposit: transfers tokens from user to pool
- `ext_amount < 0` → withdrawal: transfers tokens from pool to recipient
- `ext_amount = 0` → internal transfer (split/merge notes)
- Incremental Poseidon Merkle tree (depth 16) with 30-root history ring buffer
- Nullifier double-spend protection
- Cross-contract Groth16 BN254 proof verification
- **Recipient binding**: recomputes `extDataHash = keccak256(recipient‖relayer‖fee)` (low 31 bytes) and passes it as a public signal, so a relayer cannot redirect funds or alter the fee without invalidating the proof
- Asset-agnostic: the SAC address is set at init, so the same code backs both the XLM and USDC pools

### BN254 verifier (`contracts/bn254_verifier/`)

On-chain Groth16 verifier using Stellar Protocol 26 `bn254().pairing_check()`.
Accepts a verification key (set once), proof bytes, and public signals.

---

## What's real vs. roadmap (honest)

| Component | Status |
|---|---|
| Poseidon parity (circuit ↔ browser ↔ chain) | ✅ Proven (spike test + on-chain root match) |
| 2-in/2-out transaction circuit (arbitrary amounts) | ✅ `Transaction.circom`, ~22.8k constraints |
| BN254 Groth16 verifier on Soroban | ✅ Deployed; accepts real proof, rejects forged |
| Arbitrary-amount UTXO pool (deposit, ZK withdraw, change) | ✅ Deployed pool v3; local proofs verified |
| Web app: in-browser proving + Freighter | ✅ Live with arbitrary amount UI |
| Global tree sync from chain events | ✅ App rebuilds the full leaf set from `transact` events (works with many depositors) |
| Wallet-compatible withdraw auth | ✅ `transact` requires the submitter's auth, so every tx carries a SourceAccount entry wallets can sign |
| **extDataHash recipient binding** | ✅ On-chain: the contract recomputes `keccak256(recipient‖relayer‖fee)` (low 31 bytes) and feeds it to the verifier — tampering the recipient fails as `InvalidProof` |
| **Non-custodial relayer** | ✅ Withdrawals submitted from a relayer account (your wallet never appears on-chain); recipient is proof-bound, so the relayer cannot redirect funds |
| **Multi-asset pools** | ✅ Asset-agnostic pool deployed twice (XLM + test-USDC) with a self-serve faucet for each |
| **Event-retention window** | 🔶 Leaves cached locally + merged; a production indexer would remove reliance on RPC event retention |
| Noir KYC circuit / RISC Zero compliance | 🚧 Roadmap, not in this build |

---

## Repository layout

```
suit/
├── circuits/circom/
│   ├── Transaction.circom            # 2-in/2-out UTXO circuit (BN254, Nova model)
│   ├── Withdraw.circom               # simpler v2 withdrawal circuit (superseded)
│   ├── build_tx/                     # wasm, zkey, vk for Transaction
│   └── scripts/                      # setup + prove scripts
├── contracts/
│   ├── pool_v3/                      # arbitrary-amount UTXO pool (transact entrypoint)
│   ├── bn254_verifier/               # real BN254 Groth16 verifier (Protocol 26 pairing)
│   ├── poseidon_spike/               # proof that host Poseidon == circomlib
│   ├── pool_v2/                      # v2 fixed-denomination (superseded)
│   ├── groth16_verifier/ pool/       # v1 BLS12-381 (superseded)
├── app/                              # React dApp (in-browser proving + Freighter)
├── scripts/                          # deploy + integration + e2e tests
└── README.md
```

## Reproduce

```bash
# transaction circuit + setup + local proof verification
cd circuits/circom && npm i
circom Transaction.circom --r1cs --wasm --sym --output build_tx
node scripts/setup_tx.js && node scripts/prove_tx.js   # deposit ✓, withdraw ✓

# contract tests
cd ../../contracts/poseidon_spike && cargo test     # host Poseidon == circomlib
cd ../bn254_verifier && cargo test                  # accepts valid / rejects forged
cd ../pool_v3 && cargo test                         # deposit → withdraw → double-spend

# e2e proof generation (deposit 137, withdraw 50, change 87)
cd ../../ && node scripts/nova_e2e.js
```

## ZK stack (Stellar Hacks alignment)

- **Circom** — one of the three recommended ZK tools for the hackathon
- **BN254 + Poseidon** — the exact Protocol 25/26 host functions the hackathon showcases (`bn254_pairing_check`, `poseidon_permutation`)
- **Groth16** — fast in-browser proving via snarkjs, verified on-chain
- **Hermez community ptau** — trusted setup ceremony artifact (2^15, publicly auditable)

## License
MIT.
