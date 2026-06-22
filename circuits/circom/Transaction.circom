pragma circom 2.0.0;

// SUIT — Nova-style arbitrary-amount shielded transaction (2-in / 2-out).
//
// UTXO notes carry an amount: commitment = Poseidon(amount, pubKey, blinding),
// where pubKey = Poseidon(privKey). A transaction spends up to 2 input notes
// and creates 2 output notes, proving in zero-knowledge:
//   - each non-zero input's commitment is in the Merkle tree (root),
//   - input nullifiers are correct and unique (owner-bound via a signature),
//   - output amounts are in range (no overflow / negatives),
//   - value conservation: sum(inputs) + publicAmount = sum(outputs).
// publicAmount > 0 = deposit into the pool; publicAmount < 0 (mod p) = withdraw.
// This supports ARBITRARY amounts (deposit/withdraw/split) while unlinkable.

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/mux1.circom";

template Keypair() {
    signal input privateKey;
    signal output publicKey;
    component h = Poseidon(1);
    h.inputs[0] <== privateKey;
    publicKey <== h.out;
}

template Signature() {
    signal input privateKey;
    signal input commitment;
    signal input merklePath;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== privateKey;
    h.inputs[1] <== commitment;
    h.inputs[2] <== merklePath;
    out <== h.out;
}

// ForceEqualIfEnabled is provided by circomlib/comparators.circom

template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices; // integer leaf index
    signal output root;
    component bits = Num2Bits(levels);
    bits.in <== pathIndices;
    component mux[levels];
    component hash[levels];
    signal h[levels + 1];
    h[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== h[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== h[i];
        mux[i].s <== bits.out[i];
        hash[i] = Poseidon(2);
        hash[i].inputs[0] <== mux[i].out[0];
        hash[i].inputs[1] <== mux[i].out[1];
        h[i + 1] <== hash[i].out;
    }
    root <== h[levels];
}

template Transaction(levels, nIns, nOuts) {
    // public
    signal input root;
    signal input publicAmount;
    signal input extDataHash;
    signal input inputNullifier[nIns];
    signal input outputCommitment[nOuts];
    // private — inputs
    signal input inAmount[nIns];
    signal input inPrivateKey[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndices[nIns];
    signal input inPathElements[nIns][levels];
    // private — outputs
    signal input outAmount[nOuts];
    signal input outPubkey[nOuts];
    signal input outBlinding[nOuts];

    component inKeypair[nIns];
    component inCommitment[nIns];
    component inSignature[nIns];
    component inNullifier[nIns];
    component inTree[nIns];
    component inCheckRoot[nIns];
    var sumIns = 0;

    for (var i = 0; i < nIns; i++) {
        inKeypair[i] = Keypair();
        inKeypair[i].privateKey <== inPrivateKey[i];

        inCommitment[i] = Poseidon(3);
        inCommitment[i].inputs[0] <== inAmount[i];
        inCommitment[i].inputs[1] <== inKeypair[i].publicKey;
        inCommitment[i].inputs[2] <== inBlinding[i];

        inSignature[i] = Signature();
        inSignature[i].privateKey <== inPrivateKey[i];
        inSignature[i].commitment <== inCommitment[i].out;
        inSignature[i].merklePath <== inPathIndices[i];

        inNullifier[i] = Poseidon(3);
        inNullifier[i].inputs[0] <== inCommitment[i].out;
        inNullifier[i].inputs[1] <== inPathIndices[i];
        inNullifier[i].inputs[2] <== inSignature[i].out;
        inNullifier[i].out === inputNullifier[i];

        inTree[i] = MerkleProof(levels);
        inTree[i].leaf <== inCommitment[i].out;
        inTree[i].pathIndices <== inPathIndices[i];
        for (var j = 0; j < levels; j++) {
            inTree[i].pathElements[j] <== inPathElements[i][j];
        }
        // membership only enforced for non-zero inputs (dummy 0-notes skip it)
        inCheckRoot[i] = ForceEqualIfEnabled();
        inCheckRoot[i].enabled <== inAmount[i];
        inCheckRoot[i].in[0] <== root;
        inCheckRoot[i].in[1] <== inTree[i].root;

        sumIns += inAmount[i];
    }

    component outCommitment[nOuts];
    component outRange[nOuts];
    var sumOuts = 0;
    for (var i = 0; i < nOuts; i++) {
        outCommitment[i] = Poseidon(3);
        outCommitment[i].inputs[0] <== outAmount[i];
        outCommitment[i].inputs[1] <== outPubkey[i];
        outCommitment[i].inputs[2] <== outBlinding[i];
        outCommitment[i].out === outputCommitment[i];

        outRange[i] = Num2Bits(248);
        outRange[i].in <== outAmount[i];

        sumOuts += outAmount[i];
    }

    // input nullifiers must be distinct (no in-tx double spend)
    component sameNull = IsEqual();
    sameNull.in[0] <== inputNullifier[0];
    sameNull.in[1] <== inputNullifier[1];
    sameNull.out === 0;

    // value conservation
    sumIns + publicAmount === sumOuts;

    // bind extDataHash (recipient/fee) so a valid proof can't be re-pointed
    signal extSq;
    extSq <== extDataHash * extDataHash;
}

component main {public [root, publicAmount, extDataHash, inputNullifier, outputCommitment]} = Transaction(16, 2, 2);
