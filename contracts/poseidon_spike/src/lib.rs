#![no_std]
mod params;

#[cfg(test)]
mod test {
    extern crate std;
    use crate::params::{C_HEX, EXPECTED_HEX, M_HEX};
    use soroban_sdk::{symbol_short, Bytes, Env, Vec, U256};

    fn decode32(s: &str) -> [u8; 32] {
        let mut a = [0u8; 32];
        for i in 0..32 {
            a[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
        }
        a
    }
    fn u256(env: &Env, hex: &str) -> U256 {
        U256::from_be_bytes(env, &Bytes::from_array(env, &decode32(hex)))
    }

    #[test]
    fn host_poseidon_matches_circomlib() {
        let env = Env::default();

        // round constants reshaped to (rounds_f + rounds_p) x t = 65 x 3
        let mut rc: Vec<Vec<U256>> = Vec::new(&env);
        for x in 0..65usize {
            let mut row: Vec<U256> = Vec::new(&env);
            for y in 0..3usize {
                row.push_back(u256(&env, C_HEX[x * 3 + y]));
            }
            rc.push_back(row);
        }
        // MDS 3 x 3
        let mut mds: Vec<Vec<U256>> = Vec::new(&env);
        for x in 0..3usize {
            let mut row: Vec<U256> = Vec::new(&env);
            for y in 0..3usize {
                row.push_back(u256(&env, M_HEX[x * 3 + y]));
            }
            mds.push_back(row);
        }
        // circomlib sponge for 2 inputs: state = [0, in0, in1]
        let mut input: Vec<U256> = Vec::new(&env);
        input.push_back(U256::from_u32(&env, 0));
        input.push_back(U256::from_u32(&env, 1));
        input.push_back(U256::from_u32(&env, 2));

        let hz = env.crypto_hazmat();
        let out = hz.poseidon_permutation(
            &input,
            symbol_short!("BN254"),
            3,  // t
            5,  // d (S-box degree)
            8,  // full rounds
            57, // partial rounds
            &mds,
            &rc,
        );

        let got = out.get(0).unwrap();
        let expected = u256(&env, EXPECTED_HEX);
        assert_eq!(got, expected, "host Poseidon must match circomlib poseidon2([1,2])");
    }
}
