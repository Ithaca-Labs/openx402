#![no_std]

use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env, Vec};
use stellar_accounts::verifiers::{ed25519, Verifier};

#[contract]
pub struct Ed25519Verifier;

#[contractimpl]
impl Verifier for Ed25519Verifier {
    type KeyData = BytesN<32>;
    type SigData = BytesN<64>;

    fn verify(env: &Env, hash: Bytes, key_data: BytesN<32>, sig_data: BytesN<64>) -> bool {
        ed25519::verify(env, &hash, &key_data, &sig_data)
    }

    fn canonicalize_key(env: &Env, key_data: BytesN<32>) -> Bytes {
        ed25519::canonicalize_key(env, &key_data)
    }

    fn batch_canonicalize_key(env: &Env, key_data: Vec<BytesN<32>>) -> Vec<Bytes> {
        ed25519::batch_canonicalize_key(env, &key_data)
    }
}
