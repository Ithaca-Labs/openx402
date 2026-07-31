#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementNoticeV1 {
    pub actual: i128,
    pub max_amount: i128,
    pub pay_to: Address,
    pub payer: Address,
    pub settlement_id: BytesN<32>,
    pub token: Address,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    BurnIterations,
    Calls,
    RecordCalls,
}

#[contract]
pub struct TestSettlementHook;

#[contractimpl]
impl TestSettlementHook {
    pub fn configure(env: Env, burn_iterations: u32, record_calls: bool) {
        env.storage()
            .instance()
            .set(&DataKey::BurnIterations, &burn_iterations);
        env.storage()
            .instance()
            .set(&DataKey::RecordCalls, &record_calls);
    }

    pub fn calls(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Calls).unwrap_or(0)
    }

    pub fn on_settled_v1(env: Env, notice: SettlementNoticeV1, caller: Address) {
        caller.require_auth();

        let iterations: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BurnIterations)
            .unwrap_or(0);
        let mut state = notice.settlement_id;
        for _ in 0..iterations {
            state = env.crypto().sha256(&state.to_bytes()).to_bytes();
        }

        if env
            .storage()
            .instance()
            .get(&DataKey::RecordCalls)
            .unwrap_or(false)
        {
            let calls = Self::calls(env.clone()) + 1;
            env.storage().instance().set(&DataKey::Calls, &calls);
        }

        // SHA-256 is a host call, so each iteration is included in Soroban's
        // resource accounting even though the final digest is not persisted.
        let _ = state;
    }
}
