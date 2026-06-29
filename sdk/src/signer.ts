// SUIT Protocol SDK — Signer implementations

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Signer } from './types';

export class KeypairSigner implements Signer {
  private kp: Keypair;

  constructor(secretKey: string) {
    this.kp = Keypair.fromSecret(secretKey);
  }

  async getAddress(): Promise<string> {
    return this.kp.publicKey();
  }

  async signTransaction(preparedXdr: string, networkPassphrase: string): Promise<string> {
    const tx = TransactionBuilder.fromXDR(preparedXdr, networkPassphrase) as any;
    tx.sign(this.kp);
    return tx.toXDR();
  }
}
