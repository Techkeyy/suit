# @suit-protocol/sdk

**Pluggable ZK payment privacy for Stellar.**

The SUIT SDK is the protocol layer underneath the [SUIT app](https://suit-app.vercel.app):
a wallet-agnostic, storage-agnostic TypeScript library for shielding value into an
on-chain UTXO pool, withdrawing any portion unlinkably with a Groth16 proof, and —
when *you* choose — proving exactly what you did to an auditor.

Same circuit, same contracts, same proofs as the app. Drop it into any Stellar
project: a wallet, a payroll tool, a treasury dashboard, a CLI.

> **Private by default. Auditable by choice.**

---

## Install

```bash
npm install @suit-protocol/sdk
```

Peer requirements: the Transaction circuit artifacts (`Transaction.wasm`,
`Transaction_final.zkey`) must be reachable at runtime — in the browser, serve them
as static files; in Node, pass filesystem paths.

---

## Quick start

```ts
import { SuitPool, KeypairSigner } from '@suit-protocol/sdk';

const pool = new SuitPool({
  network: 'testnet',
  poolId:    'CDGGJTTWSOGHKO6GCZTZQUIO4U2Y5PUQOSAWESGUUC74QUXDHGIPPX6X',
  tokenId:   'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  verifierId:'CDEZRSL6WXBEJZ45WVFDI6DIHJEZ6UEWY3CUJIQPLCQIVUMLXXVKON2T',
  startLedger: 3239820,
  signer:    new KeypairSigner(process.env.SECRET_KEY!),
  noteStore: myNoteStore,        // see "Interfaces" below
  circuitWasmPath: '/circuit-tx/Transaction.wasm',
  circuitZkeyPath: '/circuit-tx/Transaction_final.zkey',
  relayerUrl: '/api/relay',      // optional — falls back to self-submit
});

// Deposit any amount into the shielded pool
const { note } = await pool.shield('100.5', step => console.log(step));

// Withdraw any portion to any address — unlinkable to the deposit
const { changeNote } = await pool.withdraw(note, '40', recipientAddress);
```

Two functions cover the whole payment flow. Everything else — Merkle sync, proof
generation, nullifier derivation, recipient binding, relayer fallback — is internal.

---

## Interfaces

The SDK never hardcodes a wallet or a database. You plug in three small adapters.

### `Signer` — wallet-agnostic

```ts
interface Signer {
  getAddress(): Promise<string>;
  signTransaction(preparedXdr: string, networkPassphrase: string): Promise<string>;
}
```

Ships with `KeypairSigner` (raw secret key, for scripts/servers). The app implements
a `FreighterSigner` over `@stellar/freighter-api`. Implement your own for Albedo,
Ledger, WalletConnect, a backend HSM — anything that can sign a Stellar tx.

### `NoteStore` — storage-agnostic

```ts
interface NoteStore {
  getNotes(poolId: string): UTXONote[];
  saveNotes(poolId: string, notes: UTXONote[]): void;
  getViewingSeed(poolId: string): string | null;
  setViewingSeed(poolId: string, seed: string): void;
  getAuditLog(poolId: string): EncryptedAuditEntry[];
  appendAuditEntry(poolId: string, entry: EncryptedAuditEntry): void;
}
```

Secret note material and the encrypted audit log live here. The app uses
`localStorage`; a server might use Postgres, a wallet might use IndexedDB or the
device keystore. Notes are the only secrets — the Merkle tree is reconstructed from
chain events, so a `NoteStore` never has to be authoritative about pool state.

### `LeafCache` — optional tree persistence

```ts
interface LeafCache {
  load(poolId: string): Map<number, string>;
  save(poolId: string, data: Map<number, string>): void;
}
```

Persists reconstructed leaves so the tree survives past the RPC's event-retention
window. Optional — omit it and the SDK syncs from `startLedger` each session.

---

## Auditable by choice

Privacy that can't be disclosed is a liability for anyone who has to answer to a
regulator. SUIT separates *spending* from *seeing*.

### Viewing keys

A viewing key is a symmetric key that decrypts your audit log. Hand it to an auditor
with an exported package and they can recompute `Poseidon(amount, pubKey, blinding)`
for every note and check it against the on-chain commitment — they see **every amount
you shielded and withdrew**, but they hold no private key, so they can **never spend**.

```ts
import { getViewingKeyHex, exportAuditPackage, verifyAuditPackage } from '@suit-protocol/sdk';

const viewingKey = getViewingKeyHex(noteStore, poolId);   // share out-of-band
const pkg        = exportAuditPackage(pool.config);        // hand to the auditor

// Auditor side (static — needs only the package + key + an RPC URL):
const report = await verifyAuditPackage(pkg, viewingKey);
// → { valid, totalShielded, totalWithdrawn, netBalance, entries: [{ ..., onChainVerified }] }
```

### Compliance receipts

A receipt is a voluntary, point-in-time proof that links **one** withdrawal back to
**one** deposit — for a tax filing or a specific inquiry, without exposing the rest of
your activity.

```ts
import { generateReceipt, verifyReceipt } from '@suit-protocol/sdk';

const receipt = generateReceipt(
  poolId, 'testnet', spentNote,
  withdrawAmountStroops, recipient, withdrawTxHash, changeNote,
);

// Anyone can verify against chain state:
const v = await verifyReceipt(receipt);
// → { valid, commitmentValid, commitmentOnChain, nullifierBurned }
```

`commitmentValid` re-derives the Poseidon commitment from the disclosed amount;
`commitmentOnChain` confirms that deposit actually entered the pool.

---

## Architecture

```
@suit-protocol/sdk
├── pool.ts         SuitPool — shield() / withdraw() / getRoot() / getCount()
├── crypto.ts       field arithmetic, Poseidon wrappers, extDataHash binding
├── tree.ts         depth-16 Poseidon Merkle tree (root, path, zeros)
├── sync.ts         LeafSyncer — rebuilds the tree from `transact` events
├── proofs.ts       dummy inputs + Groth16 point encoding for the verifier
├── relayer.ts      non-custodial relayer client (GET info, POST bundle)
├── signer.ts       Signer interface + KeypairSigner
├── viewing-key.ts  AES-GCM audit log, export/verify (Web Crypto, zero-dep)
├── compliance.ts   receipt generation + on-chain verification
└── types.ts        all interfaces and data types
```

Every byte of the proof path — Poseidon constants, commitment layout, the
`keccak256(recipient‖relayer‖fee)` recipient binding — matches the on-chain
`pool_v3` contract exactly. The chain only ever sees roots, nullifiers, and
commitments; never amounts or the link between a deposit and a withdrawal.

---

## API reference

| Method | Description |
|---|---|
| `new SuitPool(config)` | Construct a pool client for one asset deployment. |
| `pool.shield(amount, onStep?)` | Deposit any amount; returns `{ txHash, note }`. |
| `pool.withdraw(note, amount, recipient, onStep?)` | Withdraw any portion; returns `{ txHash, changeNote }`. |
| `pool.getRoot()` / `pool.getCount()` | Current on-chain Merkle root / leaf count. |
| `pool.getNotes()` | Local notes for this pool from the `NoteStore`. |
| `pool.syncLeaves(force?)` | Rebuild the leaf set from chain events. |
| `pool.getRelayerInfo()` | Relayer pubkey + fee, or `null` if offline. |
| `getViewingKeyHex` / `exportAuditPackage` / `verifyAuditPackage` | Viewing-key disclosure flow. |
| `generateReceipt` / `verifyReceipt` | Compliance receipt flow. |

---

## License

MIT.
