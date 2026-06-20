// SUIT Protocol SDK — Pool & verifier interaction
//
// Thin, honest wrappers over the deployed Soroban contracts. These build the
// exact same calls the live demo (scripts/demo.sh) makes:
//   - verifyOnChain → Groth16Verifier.verify
//   - deposit       → SuitPool.deposit (ZK-gated)
//   - withdraw      → SuitPool.withdraw (Merkle path + nullifier)

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';
import { SuitConfig, DepositParams, WithdrawParams, TxResult } from './types';

function server(config: SuitConfig): rpc.Server {
  return new rpc.Server(rpcUrl(config), { allowHttp: config.network === 'local' });
}
function rpcUrl(config: SuitConfig): string {
  if (config.rpcUrl) return config.rpcUrl;
  if (config.network === 'mainnet') return 'https://mainnet.sorobanrpc.com';
  if (config.network === 'local') return 'http://localhost:8000/rpc';
  return 'https://soroban-testnet.stellar.org';
}
function passphrase(config: SuitConfig): string {
  if (config.network === 'mainnet') return Networks.PUBLIC;
  if (config.network === 'local') return Networks.STANDALONE;
  return Networks.TESTNET;
}
function bytesScVal(hex: string): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
}

async function submit(
  config: SuitConfig,
  secret: string,
  call: xdr.Operation
): Promise<TxResult> {
  const srv = server(config);
  const kp = Keypair.fromSecret(secret);
  const account = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase(config),
  })
    .addOperation(call)
    .setTimeout(30)
    .build();

  const sim = await srv.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);
  const sent = await srv.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`Tx failed: ${JSON.stringify(sent.errorResult)}`);
  }
  // poll
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = await srv.getTransaction(sent.hash);
    if (got.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break;
  }
  return { txHash: sent.hash };
}

/** Read-only on-chain verification of a Groth16 proof. */
export async function verifyOnChain(
  config: SuitConfig,
  proofHex: string,
  publicHex: string
): Promise<boolean> {
  const srv = server(config);
  const kp = Keypair.random();
  // Use a funded source for simulation isn't required for read-only sim, but
  // getAccount needs an existing account; use the verifier call via simulate.
  const contract = new Contract(config.groth16VerifierId);
  const account = new (await import('@stellar/stellar-sdk')).Account(
    kp.publicKey(),
    '0'
  );
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase(config),
  })
    .addOperation(contract.call('verify', bytesScVal(proofHex), bytesScVal(publicHex)))
    .setTimeout(30)
    .build();
  const sim = await srv.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result) {
    throw new Error('verify simulation failed');
  }
  return scValToNative(sim.result.retval) as boolean;
}

/** Deposit the fixed denomination into the pool. Gated by the on-chain proof. */
export async function deposit(
  config: SuitConfig,
  params: DepositParams
): Promise<TxResult> {
  const kp = Keypair.fromSecret(params.senderSecretKey);
  const contract = new Contract(config.poolContractId);
  const op = contract.call(
    'deposit',
    new Address(kp.publicKey()).toScVal(),
    bytesScVal(params.commitmentHex),
    bytesScVal(params.proofHex),
    bytesScVal(params.publicHex)
  );
  return submit(config, params.senderSecretKey, op);
}

/** Withdraw the denomination by revealing a nullifier and a Merkle path. */
export async function withdraw(
  config: SuitConfig,
  params: WithdrawParams
): Promise<TxResult> {
  const contract = new Contract(config.poolContractId);
  const pathElements = xdr.ScVal.scvVec(
    params.pathElements.map((h) => bytesScVal(h))
  );
  const pathIndices = xdr.ScVal.scvVec(
    params.pathIndices.map((i) => nativeToScVal(i, { type: 'u32' }))
  );
  const op = contract.call(
    'withdraw',
    new Address(params.recipient).toScVal(),
    bytesScVal(params.nullifierHex),
    bytesScVal(params.leafHex),
    pathElements,
    pathIndices,
    bytesScVal(params.rootHex)
  );
  return submit(config, params.senderSecretKey, op);
}
