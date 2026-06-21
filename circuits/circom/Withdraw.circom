pragma circom 2.0.0;

// SUIT — unlinkable withdrawal circuit (Tornado-style), BN254 / circomlib Poseidon.
//
// Proves knowledge of a note (nullifier, secret) whose commitment
//   commitment = Poseidon(nullifier, secret)
// is a leaf in the pool's Merkle tree with the given root, and exposes
//   nullifierHash = Poseidon(nullifier)
// so the pool can prevent double-spends — WITHOUT revealing which leaf is spent.
//
// Public inputs: root, nullifierHash, recipient.
//   - root / nullifierHash gate the spend.
//   - recipient is bound into the proof (squared) so a valid proof can't be
//     re-targeted to a different address by a front-runner.

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/mux1.circom";

template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;
    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    hash <== h.out;
}

// Verifies a Merkle path: pathIndices[i]=0 → current node is left child.
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component selectors[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        selectors[i] = MultiMux1(2);
        selectors[i].c[0][0] <== (i == 0) ? leaf : hashers[i - 1].hash;
        selectors[i].c[0][1] <== pathElements[i];
        selectors[i].c[1][0] <== pathElements[i];
        selectors[i].c[1][1] <== (i == 0) ? leaf : hashers[i - 1].hash;
        selectors[i].s <== pathIndices[i];

        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
    }

    root === hashers[levels - 1].hash;
}

template Withdraw(levels) {
    // public
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    // private
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // commitment = Poseidon(nullifier, secret)
    component cm = Poseidon(2);
    cm.inputs[0] <== nullifier;
    cm.inputs[1] <== secret;

    // nullifierHash = Poseidon(nullifier)
    component nh = Poseidon(1);
    nh.inputs[0] <== nullifier;
    nh.out === nullifierHash;

    // membership
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== cm.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // bind recipient so the proof can't be re-pointed
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

component main {public [root, nullifierHash, recipient]} = Withdraw(16);
