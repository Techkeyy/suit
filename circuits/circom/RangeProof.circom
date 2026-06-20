pragma circom 2.0.0;

include "node_modules/circomlib/circuits/bitify.circom";

template RangeProof() {
    signal input amount;
    signal input secret;
    signal input min_amount;
    signal input max_amount;
    signal input commitment;

    signal diff_low;
    signal diff_high;

    diff_low <== amount - min_amount;
    component check_low = Num2Bits(64);
    check_low.in <== diff_low;

    diff_high <== max_amount - amount;
    component check_high = Num2Bits(64);
    check_high.in <== diff_high;

    commitment === amount + secret;
}

component main {public [min_amount, max_amount, commitment]} = RangeProof();
