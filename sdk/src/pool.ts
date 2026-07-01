// SUIT Protocol SDK — SuitPool: the developer-facing API
//
// pool.shield(amount)   → deposit any amount into the shielded pool
// pool.withdraw(note, amount, recipient) → withdraw unlinkably

import {
  rpc, Contract, TransactionBuilder, Address, xdr,
  scValToNative, nativeToScVal, Networks, BASE_FEE,
} from '@stellar/stellar-sdk';
import type {
  SuitPoolConfig, Signer, NoteStore, UTXONote,
  ShieldResult, WithdrawResult, AuditEntry,
} from './types';
import {
  P, randomField, pubKeyOf, commitHash, signHash, nullHash,
  be, bytesToBig, concatBytes, toHex, scvBytes,
  extDataHashField, amountToStroops, stroopsToAmount,
} from './crypto';
import { treeRoot, treePath, computeZeros } from './tree';
import { dummyInput, encodeProof } from './proofs';
import { LeafSyncer } from './sync';
import { getRelayerInfo as fetchRelayerInfo, relaySubmit } from './relayer';
import { appendAuditLog } from './viewing-key';

export class SuitPool {
  readonly config: SuitPoolConfig;
  private server: rpc.Server;
  private passphrase: string;
  private syncer: LeafSyncer;
  private depth: number;
  private decimals: number;

  constructor(config: SuitPoolConfig) {
    this.config = config;
    this.depth = config.depth ?? 16;
    this.decimals = config.decimals ?? 7;
    this.passphrase = config.networkPassphrase ??
      (config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);

    const rpcUrl = config.rpcUrl ??
      (config.network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
    this.server = new rpc.Server(rpcUrl);
    this.syncer = new LeafSyncer(
      { rpcUrl, poolId: config.poolId, startLedger: config.startLedger },
      config.leafCache,
    );
  }

  // ── Read-only queries ──

  async getRoot(): Promise<bigint> {
    const val = await this.callView('get_root');
    return val ? bytesToBig(val) : computeZeros(this.depth)[this.depth];
  }

  async getCount(): Promise<number> {
    try { return Number(await this.callView('get_count')) || 0; } catch { return 0; }
  }

  async getRelayerInfo() {
    if (!this.config.relayerUrl) return null;
    return fetchRelayerInfo(this.config.relayerUrl);
  }

  async syncLeaves(force = false) {
    return this.syncer.sync(force);
  }

  getNotes(): UTXONote[] {
    return this.config.noteStore.getNotes(this.config.poolId);
  }

  // ── Shield (deposit) ──

  async shield(
    amount: string,
    onStep?: (m: string) => void,
  ): Promise<ShieldResult> {
    const amt = amountToStroops(amount, this.decimals);
    if (amt <= 0n) throw new Error('Amount must be positive');

    const address = await this.config.signer.getAddress();
    const snarkjs = await import('snarkjs');

    onStep?.('Reading pool state…');
    const countBefore = await this.getCount();
    const root = await this.getRoot();

    onStep?.('Generating secret note…');
    const priv = randomField(), blinding = randomField();
    const pk = pubKeyOf(priv);
    const outCommit = commitHash(amt, pk, blinding);
    const dPriv = randomField(), dBlind = randomField();
    const dPk = pubKeyOf(dPriv);
    const dummyCommit = commitHash(0n, dPk, dBlind);
    const inA = dummyInput(this.depth), inB = dummyInput(this.depth);

    const extHash = extDataHashField(address, address, 0n);

    onStep?.('Generating zero-knowledge proof… (~30 s)');
    const { proof } = await snarkjs.groth16.fullProve({
      root: root.toString(),
      publicAmount: amt.toString(),
      extDataHash: extHash.toString(),
      inputNullifier: [inA.nullifier.toString(), inB.nullifier.toString()],
      outputCommitment: [outCommit.toString(), dummyCommit.toString()],
      inAmount: ['0', '0'],
      inPrivateKey: [inA.priv.toString(), inB.priv.toString()],
      inBlinding: [inA.blinding.toString(), inB.blinding.toString()],
      inPathIndices: ['0', '0'],
      inPathElements: [inA.pathElements, inB.pathElements],
      outAmount: [amt.toString(), '0'],
      outPubkey: [pk.toString(), dPk.toString()],
      outBlinding: [blinding.toString(), dBlind.toString()],
    }, this.config.circuitWasmPath, this.config.circuitZkeyPath);

    onStep?.('Submitting to Stellar…');
    const contract = new Contract(this.config.poolId);
    const op = contract.call(
      'transact',
      scvBytes(encodeProof(proof)),
      scvBytes(be(root)),
      nativeToScVal(amt, { type: 'i128' }),
      xdr.ScVal.scvVec([scvBytes(be(inA.nullifier)), scvBytes(be(inB.nullifier))]),
      xdr.ScVal.scvVec([scvBytes(be(outCommit)), scvBytes(be(dummyCommit))]),
      new Address(address).toScVal(),
      new Address(address).toScVal(),
      new Address(address).toScVal(),
      nativeToScVal(0n, { type: 'i128' }),
    );
    const txHash = await this.signAndSend(address, op, onStep);
    this.syncer.invalidate();

    const note: UTXONote = {
      amount: amt.toString(), privKey: priv.toString(), blinding: blinding.toString(),
      commitment: outCommit.toString(), leafIndex: countBefore, spent: false,
      txHash, ts: Date.now(),
    };
    const notes = [...this.getNotes(), note];
    this.config.noteStore.saveNotes(this.config.poolId, notes);

    await appendAuditLog(this.config.noteStore, this.config.poolId, {
      type: 'shield', amount: amt.toString(), pubKey: pk.toString(),
      blinding: blinding.toString(), commitment: outCommit.toString(),
      leafIndex: countBefore, txHash, timestamp: Date.now(),
    });

    return { txHash, note };
  }

  // ── Withdraw ──

  async withdraw(
    note: UTXONote,
    amount: string,
    recipient: string,
    onStep?: (m: string) => void,
  ): Promise<WithdrawResult> {
    const wAmt = amountToStroops(amount, this.decimals);
    const nAmt = BigInt(note.amount);
    if (wAmt <= 0n) throw new Error('Amount must be positive');
    if (wAmt > nAmt) throw new Error('Exceeds note balance');

    const address = await this.config.signer.getAddress();

    onStep?.('Contacting relayer…');
    const relayerInfo = this.config.relayerUrl ? await this.getRelayerInfo() : null;
    const useRelayer = !!relayerInfo;
    const relayerAddr = relayerInfo?.relayer || address;
    const fee = useRelayer ? BigInt(relayerInfo!.fee || '0') : 0n;
    if (fee < 0n || fee > wAmt) throw new Error('Relayer fee out of range.');

    const snarkjs = await import('snarkjs');
    onStep?.('Syncing pool tree from chain…');

    let leaves = await this.syncer.sync(true);

    // Completeness guard: the reconstructed tree must hold exactly the on-chain
    // leaf set. The contract keeps only 30 historical roots and inserts 2 leaves
    // per transact (~15 transactions deep), so a tree that's missing recent
    // leaves yields a root that has aged out of history → UnknownRoot (#4) at
    // submit. Detect the gap up front and re-sync once before wasting a proof.
    const onchainCount = await this.getCount();
    if (leaves.length !== onchainCount) {
      this.syncer.invalidate();
      leaves = await this.syncer.sync(true);
      if (leaves.length !== onchainCount) {
        throw new Error(
          `Pool tree sync incomplete (${leaves.length}/${onchainCount} leaves) — the indexer is catching up. Retry in a few seconds.`,
        );
      }
    }

    const commitment = BigInt(note.commitment);
    const leafIndex = leaves.findIndex(l => l === commitment);
    if (leafIndex < 0) throw new Error('Note not found in on-chain tree yet — wait for the deposit to index, then retry.');

    const root = treeRoot(leaves, this.depth);
    if (!(await this.knownRoot(root))) {
      throw new Error(
        'Reconstructed pool root not recognized on-chain — local tree is stale. Retry in a moment; if it persists, the pool indexer is behind.',
      );
    }
    const path = treePath(leafIndex, leaves, this.depth);

    const priv = BigInt(note.privKey);
    const sig = signHash(priv, commitment, BigInt(leafIndex));
    const null0 = nullHash(commitment, BigInt(leafIndex), sig);
    const inDummy = dummyInput(this.depth);

    const changeAmt = nAmt - wAmt;
    const cPriv = randomField(), cBlind = randomField();
    const changeCommit = commitHash(changeAmt, pubKeyOf(cPriv), cBlind);
    const zPriv = randomField(), zBlind = randomField();
    const zeroCommit = commitHash(0n, pubKeyOf(zPriv), zBlind);

    const publicAmount = (P - wAmt) % P;
    const extHash = extDataHashField(recipient, relayerAddr, fee);

    onStep?.('Generating zero-knowledge proof… (~30 s)');
    const { proof } = await snarkjs.groth16.fullProve({
      root: root.toString(),
      publicAmount: publicAmount.toString(),
      extDataHash: extHash.toString(),
      inputNullifier: [null0.toString(), inDummy.nullifier.toString()],
      outputCommitment: [changeCommit.toString(), zeroCommit.toString()],
      inAmount: [nAmt.toString(), '0'],
      inPrivateKey: [priv.toString(), inDummy.priv.toString()],
      inBlinding: [note.blinding, inDummy.blinding.toString()],
      inPathIndices: [leafIndex.toString(), '0'],
      inPathElements: [path.map(x => x.toString()), inDummy.pathElements],
      outAmount: [changeAmt.toString(), '0'],
      outPubkey: [pubKeyOf(cPriv).toString(), pubKeyOf(zPriv).toString()],
      outBlinding: [cBlind.toString(), zBlind.toString()],
    }, this.config.circuitWasmPath, this.config.circuitZkeyPath);

    const proofBytes = encodeProof(proof);
    let txHash: string;

    if (useRelayer && this.config.relayerUrl) {
      onStep?.('Submitting via relayer — your wallet never touches the chain…');
      txHash = await relaySubmit(this.config.relayerUrl, {
        poolId: this.config.poolId,
        proof: toHex(proofBytes),
        root: toHex(be(root)),
        extAmount: (-wAmt).toString(),
        nullifiers: [toHex(be(null0)), toHex(be(inDummy.nullifier))],
        commitments: [toHex(be(changeCommit)), toHex(be(zeroCommit))],
        recipient,
        fee: fee.toString(),
      });
    } else {
      onStep?.('Relayer offline — submitting from your wallet (visible)…');
      const contract = new Contract(this.config.poolId);
      const op = contract.call(
        'transact',
        scvBytes(proofBytes),
        scvBytes(be(root)),
        nativeToScVal(-wAmt, { type: 'i128' }),
        xdr.ScVal.scvVec([scvBytes(be(null0)), scvBytes(be(inDummy.nullifier))]),
        xdr.ScVal.scvVec([scvBytes(be(changeCommit)), scvBytes(be(zeroCommit))]),
        new Address(address).toScVal(),
        new Address(recipient).toScVal(),
        new Address(address).toScVal(),
        nativeToScVal(0n, { type: 'i128' }),
      );
      txHash = await this.signAndSend(address, op, onStep);
    }
    this.syncer.invalidate();

    const notes = this.getNotes().map(n =>
      n.commitment === note.commitment
        ? {
            ...n, spent: true, withdrawTxHash: txHash, recipient,
            withdrawAmount: wAmt.toString(),
            changeCommitment: changeAmt > 0n ? changeCommit.toString() : undefined,
          }
        : n
    );
    let savedChange: UTXONote | null = null;
    if (changeAmt > 0n) {
      savedChange = {
        amount: changeAmt.toString(), privKey: cPriv.toString(), blinding: cBlind.toString(),
        commitment: changeCommit.toString(), leafIndex: leaves.length, spent: false,
        txHash, ts: Date.now(),
      };
      notes.push(savedChange);
    }
    this.config.noteStore.saveNotes(this.config.poolId, notes);

    const pk = pubKeyOf(BigInt(note.privKey));
    await appendAuditLog(this.config.noteStore, this.config.poolId, {
      type: 'withdraw', amount: wAmt.toString(), pubKey: pk.toString(),
      blinding: note.blinding, commitment: note.commitment,
      leafIndex, txHash, timestamp: Date.now(), recipient,
    });

    return { txHash, changeNote: savedChange };
  }

  // ── Internal helpers ──

  /** Read-only check that a Merkle root is in the contract's root history. */
  private async knownRoot(root: bigint): Promise<boolean> {
    try {
      const address = await this.config.signer.getAddress();
      const contract = new Contract(this.config.poolId);
      const account = await this.server.getAccount(address);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.passphrase })
        .addOperation(contract.call('known_root', scvBytes(be(root)))).setTimeout(30).build();
      const sim = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim) || !sim.result) return false;
      return !!scValToNative(sim.result.retval);
    } catch { return false; }
  }

  private async callView(method: string): Promise<any> {
    const address = await this.config.signer.getAddress();
    const contract = new Contract(this.config.poolId);
    const account = await this.server.getAccount(address);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.passphrase })
      .addOperation(contract.call(method)).setTimeout(30).build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result) return null;
    return scValToNative(sim.result.retval);
  }

  private async signAndSend(
    address: string,
    op: xdr.Operation,
    onStep?: (m: string) => void,
  ): Promise<string> {
    const account = await this.server.getAccount(address);
    const tx = new TransactionBuilder(account, {
      fee: (Number(BASE_FEE) * 1000).toString(),
      networkPassphrase: this.passphrase,
    }).addOperation(op).setTimeout(300).build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation: ${sim.error}`);
    const prepared = rpc.assembleTransaction(tx, sim).build();

    const signedXdr = await this.config.signer.signTransaction(
      prepared.toXDR(), this.passphrase,
    );
    const signed = TransactionBuilder.fromXDR(signedXdr, this.passphrase) as any;

    const sent = await this.server.sendTransaction(signed);
    if (sent.status === 'ERROR') throw new Error(`Submit: ${JSON.stringify(sent.errorResult)}`);
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const got = await this.server.getTransaction(sent.hash);
      if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
      if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Failed on-chain (${sent.hash})`);
      }
    }
    throw new Error('Not confirmed in time');
  }
}
