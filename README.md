# SUIT — Shielded Universal Payment Protocol

**Unlinkable payments on Stellar, verified by zero-knowledge.**

SUIT is a shielded payment pool on Stellar. You deposit a fixed denomination,
then later withdraw to **any** address by submitting a zero-knowledge proof that
you own *some* note in the pool — **without revealing which deposit was yours.**
An observer sees a deposit and an unrelated withdrawal, and cannot link them.

The zero-knowledge is load-bearing and real: the withdrawal proof is a Groth16
proof over **BN254**, generated **in your browser**, and verified **on-chain**
inside a Soroban contract using Stellar's BN254 pairing host functions. No valid
proof ⇒ no withdrawal.

> This is genuine Tornado-class privacy on Stellar, proven end-to-end on testnet.

---

## Live on Stellar testnet

| Contract | ID |
|---|---|
| Pool v2 (unlinkable) | [`CCTFFZ7I…LSJC`](https://stellar.expert/explorer/testnet/contract/CCTFFZ7IYXTVM66OBAUMKHVU2RCDY26NHULIHBWHOIY2UJVNPXJ5LSJC) |
| BN254 Groth16 verifier | [`CAQWWQ4P…LHMOP7`](https://stellar.expert/explorer/testnet/contract/CAQWWQ4P7RYGBDRIUQQ7FUXC3SXAHI52YCCQUVCXMNVACNBN52LHMOP7) |
| Token (native XLM SAC) | `CDLZFC3S…CYSC` |

**Proven live** (a separate demo pool, same code):
- **Deposit** → commitment inserted; the contract's Poseidon root **exactly matched** the circuit's root on real data.
- **Unlinkable withdrawal** → ZK proof verified on-chain, paid a different address — revealed only `(root, nullifierHash, recipient)`. [tx](https://stellar.expert/explorer/testnet/tx/960c1c621954cbd9263b4dac57cbb13482eb09ec6a35fb5b3ab9d4bfdd9c8422)
- **Double-spend** the same nullifier → reverts (`#6 NullifierAlreadySpent`).

App: **https://suit-app.vercel.app** (needs the Freighter wallet on testnet).

---

## How it works

```
  shield (deposit)                                   withdraw (unlinkable)
  ─────────────────                                  ─────────────────────
  note = (nullifier, secret)        browser          prove in-browser (snarkjs):
  commitment = Poseidon(note)  ───►  deposit  ──►       • commitment ∈ Merkle tree (root R)
  fixed 100 XLM in                  (on-chain          • nullifierHash = Poseidon(nullifier)
                                     Poseidon            • binds recipient
                                     Merkle tree)      Groth16 (BN254) proof
                                                          │
                                       pool.withdraw(root, nullifierHash, recipient, proof)
                                                          │  BN254 pairing check on-chain
                                                          ▼
                                       pays recipient · burns nullifier · reveals NOT which leaf
```

The Poseidon hash is **byte-identical** in the circuit (circomlib), the browser
(poseidon-lite), and the contract (Stellar's host Poseidon fed circomlib's
constants — see `contracts/poseidon_spike`). That equality is what lets an
in-browser proof verify against the on-chain tree.

---

## What's real vs. roadmap (honest)

| Component | Status |
|---|---|
| Poseidon parity (circuit ↔ browser ↔ chain) | ✅ Proven (spike test + on-chain root match) |
| Withdrawal circuit (BN254 Merkle membership + nullifier) | ✅ `circuits/circom/Withdraw.circom`, ~9k constraints |
| BN254 Groth16 verifier on Soroban | ✅ Deployed; accepts real proof, rejects forged |
| Unlinkable pool (deposit, ZK withdraw, nullifiers) | ✅ Deployed; full cycle proven on testnet |
| Web app: in-browser proving + Freighter | ✅ Live |
| **Denomination tiers** (10 / 100 / 1000) | 🚧 Single fixed 100 XLM today; tiers = same tree per size (next) |
| **`recipient_field` ↔ address binding** | 🚧 Not enforced on-chain (safe in self-withdrawal; documented) |
| Noir KYC circuit / RISC Zero compliance | 🚧 Roadmap, not in this build |

**Why a fixed denomination?** Uniformity is what makes deposits indistinguishable
— it's the privacy, not a limitation. Tiers add choice while preserving it.

**Leaf tracking:** the app stores its notes locally and is the sole depositor on
its pool, so it reconstructs Merkle paths from local state. A production build
would index commitments from chain events.

---

## Repository layout

```
suit/
├── circuits/circom/
│   ├── Withdraw.circom            # unlinkable withdrawal circuit (BN254)
│   └── build_withdraw/            # wasm, zkey, vk
├── contracts/
│   ├── pool_v2/                   # unlinkable pool: Poseidon tree + nullifiers + ZK withdraw
│   ├── bn254_verifier/            # real BN254 Groth16 verifier (Protocol 26 pairing)
│   ├── poseidon_spike/            # proof that host Poseidon == circomlib (gates everything)
│   ├── groth16_verifier/ pool/    # v1 (BLS12-381, range-proof gated) — superseded
├── app/                           # React dApp (in-browser proving + Freighter)
├── scripts/                       # deploy + integration (deployed.env has all IDs)
└── README.md
```

## Reproduce

```bash
# circuit + setup + sample proof
cd circuits/circom && npm i
circom Withdraw.circom --r1cs --wasm --sym --output build_withdraw
node scripts/setup_withdraw.js && node scripts/prove_withdraw.js   # prints LOCAL VERIFY: true

# contract tests (real Poseidon + pairing in the Soroban host)
cd ../../contracts/poseidon_spike && cargo test     # host Poseidon == circomlib
cd ../bn254_verifier && cargo test                  # accepts valid / rejects forged
cd ../pool_v2 && cargo test                         # deposit → ZK withdraw → double-spend

# end-to-end on testnet (deploy IDs in scripts/deployed.env)
node scripts/withdraw_integration.js                # builds a real withdrawal proof
```

## License
MIT.
