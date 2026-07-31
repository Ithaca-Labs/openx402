#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    Address, Env, Map, String, Val, Vec,
};
use stellar_accounts::smart_account::{
    self, AuthPayload, ContextRule, ContextRuleType, Signer, SmartAccount, SmartAccountError,
};

#[contract]
pub struct OzAgentAccount;

#[contractimpl]
impl OzAgentAccount {
    pub fn __constructor(
        env: &Env,
        settlement: Address,
        token: Address,
        signer: Signer,
        policy: Address,
        settlement_policy_params: Val,
        token_policy_params: Val,
    ) {
        let mut signers = Vec::new(env);
        signers.push_back(signer);

        let mut policies = Map::new(env);
        policies.set(policy.clone(), settlement_policy_params);

        smart_account::add_context_rule(
            env,
            &ContextRuleType::CallContract(settlement),
            &String::from_str(env, "x402_agent"),
            None,
            &signers,
            &policies,
        );

        let mut token_policies = Map::new(env);
        token_policies.set(policy, token_policy_params);
        smart_account::add_context_rule(
            env,
            &ContextRuleType::CallContract(token),
            &String::from_str(env, "x402_approve"),
            None,
            &signers,
            &token_policies,
        );
    }
}

#[contractimpl]
impl CustomAccountInterface for OzAgentAccount {
    type Error = SmartAccountError;
    type Signature = AuthPayload;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: AuthPayload,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        smart_account::do_check_auth(&env, &signature_payload, &signatures, &auth_contexts)
    }
}

#[contractimpl(contracttrait)]
impl SmartAccount for OzAgentAccount {}

#[cfg(test)]
mod test;
