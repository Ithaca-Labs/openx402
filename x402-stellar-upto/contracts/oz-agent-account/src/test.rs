extern crate std;

use super::OzAgentAccount;
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contractimpl,
    testutils::{Address as _, BytesN as _},
    vec, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val,
};
use stellar_accounts::smart_account::{AuthPayload, Signer};
use x402_ed25519_verifier::Ed25519Verifier;
use x402_reconciling_policy::{
    BudgetParams, PolicyError, PolicyParams, ReconcilingPolicy, ReconcilingPolicyClient,
    ReservationStatus, SettlementNoticeV1, TokenApprovalParams,
};

#[contract]
struct SettlementInvoker;

#[contractimpl]
impl SettlementInvoker {
    pub fn notify(env: Env, policy: Address, notice: SettlementNoticeV1) {
        ReconcilingPolicyClient::new(&env, &policy)
            .on_settled_v1(&notice, &env.current_contract_address());
    }
}

#[allow(clippy::too_many_arguments)]
fn settlement_context(
    env: &Env,
    settlement: &Address,
    pay_to: &Address,
    token: &Address,
    max_amount: i128,
    deadline: u32,
    facilitator: &Address,
    settlement_id: &BytesN<32>,
    hook: &Address,
) -> Context {
    Context::Contract(ContractContext {
        contract: settlement.clone(),
        fn_name: Symbol::new(env, "settle"),
        args: (
            pay_to.clone(),
            token.clone(),
            max_amount,
            0u32,
            deadline,
            facilitator.clone(),
            settlement_id.clone(),
            Some(hook.clone()),
        )
            .into_val(env),
    })
}

fn approval_context(
    env: &Env,
    token: &Address,
    account: &Address,
    settlement: &Address,
    max_amount: i128,
    deadline: u32,
) -> Context {
    Context::Contract(ContractContext {
        contract: token.clone(),
        fn_name: Symbol::new(env, "approve"),
        args: (account.clone(), settlement.clone(), max_amount, deadline).into_val(env),
    })
}

fn auth_payload(
    env: &Env,
    signing_key: &SigningKey,
    signer: &Signer,
    signature_payload: &BytesN<32>,
    rule_ids: soroban_sdk::Vec<u32>,
) -> AuthPayload {
    use soroban_sdk::xdr::ToXdr;

    let mut preimage = signature_payload.to_bytes();
    preimage.append(&rule_ids.clone().to_xdr(env));
    let digest = env.crypto().sha256(&preimage);
    let signature = signing_key.sign(&digest.to_array());

    let mut signatures = Map::new(env);
    signatures.set(
        signer.clone(),
        Bytes::from_slice(env, &signature.to_bytes()),
    );
    AuthPayload {
        signers: signatures,
        context_rule_ids: rule_ids,
    }
}

struct Fixture {
    account: Address,
    env: Env,
    facilitator: Address,
    hook: Address,
    key: SigningKey,
    pay_to: Address,
    settlement: Address,
    signer: Signer,
    token: Address,
}

impl Fixture {
    fn new(limit: i128) -> Self {
        let env = Env::default();
        let settlement = env.register(SettlementInvoker, ());
        let token = Address::generate(&env);
        let pay_to = Address::generate(&env);
        let facilitator = Address::generate(&env);
        let verifier = env.register(Ed25519Verifier, ());
        let hook = env.register(ReconcilingPolicy, ());
        let key = SigningKey::from_bytes(&[7; 32]);
        let signer = Signer::External(
            verifier,
            Bytes::from_slice(&env, key.verifying_key().as_bytes()),
        );
        let settlement_params: Val = PolicyParams::Settlement(BudgetParams {
            limit,
            period_ledgers: 100,
        })
        .into_val(&env);
        let token_params: Val = PolicyParams::TokenApproval(TokenApprovalParams {
            settlement: settlement.clone(),
            settlement_rule_id: 0,
        })
        .into_val(&env);
        let account = env.register(
            OzAgentAccount,
            (
                settlement.clone(),
                token.clone(),
                signer.clone(),
                hook.clone(),
                settlement_params,
                token_params,
            ),
        );

        Self {
            account,
            env,
            facilitator,
            hook,
            key,
            pay_to,
            settlement,
            signer,
            token,
        }
    }

    fn check(&self, max_amount: i128, id_byte: u8) -> bool {
        let payload = BytesN::random(&self.env);
        let auth = auth_payload(
            &self.env,
            &self.key,
            &self.signer,
            &payload,
            vec![&self.env, 0u32, 1u32],
        );
        let settlement_context = settlement_context(
            &self.env,
            &self.settlement,
            &self.pay_to,
            &self.token,
            max_amount,
            100,
            &self.facilitator,
            &BytesN::from_array(&self.env, &[id_byte; 32]),
            &self.hook,
        );
        self.env
            .try_invoke_contract_check_auth::<PolicyError>(
                &self.account,
                &payload,
                auth.into_val(&self.env),
                &vec![
                    &self.env,
                    settlement_context,
                    approval_context(
                        &self.env,
                        &self.token,
                        &self.account,
                        &self.settlement,
                        max_amount,
                        100,
                    ),
                ],
            )
            .is_ok()
    }
}

fn notice(fixture: &Fixture, id_byte: u8, actual: i128, maximum: i128) -> SettlementNoticeV1 {
    SettlementNoticeV1 {
        actual,
        max_amount: maximum,
        pay_to: fixture.pay_to.clone(),
        payer: fixture.account.clone(),
        settlement_id: BytesN::from_array(&fixture.env, &[id_byte; 32]),
        token: fixture.token.clone(),
    }
}

#[test]
fn real_check_auth_runs_context_rule_and_reserves_maximum() {
    let fixture = Fixture::new(100);
    assert!(fixture.check(70, 1));

    let budget =
        ReconcilingPolicyClient::new(&fixture.env, &fixture.hook).get_budget(&fixture.account, &0);
    assert_eq!(budget.committed, 70);
    assert_eq!(budget.limit, 100);
}

#[test]
fn real_check_auth_rejects_an_over_budget_maximum() {
    let fixture = Fixture::new(100);
    assert!(!fixture.check(101, 2));
}

#[test]
fn settlement_notice_releases_unused_budget_and_keeps_actual() {
    let fixture = Fixture::new(100);
    assert!(fixture.check(70, 5));

    SettlementInvokerClient::new(&fixture.env, &fixture.settlement)
        .notify(&fixture.hook, &notice(&fixture, 5, 30, 70));

    let client = ReconcilingPolicyClient::new(&fixture.env, &fixture.hook);
    assert_eq!(client.get_budget(&fixture.account, &0).committed, 30);
    assert_eq!(
        client
            .get_reservation(
                &fixture.account,
                &BytesN::from_array(&fixture.env, &[5; 32]),
            )
            .status,
        ReservationStatus::Settled(30),
    );
}

#[test]
fn zero_settlement_releases_the_full_reservation() {
    let fixture = Fixture::new(100);
    assert!(fixture.check(70, 6));

    SettlementInvokerClient::new(&fixture.env, &fixture.settlement)
        .notify(&fixture.hook, &notice(&fixture, 6, 0, 70));

    assert_eq!(
        ReconcilingPolicyClient::new(&fixture.env, &fixture.hook)
            .get_budget(&fixture.account, &0)
            .committed,
        0,
    );
}

#[test]
fn duplicate_id_is_rejected_after_reconciliation() {
    let fixture = Fixture::new(100);
    assert!(fixture.check(70, 7));
    SettlementInvokerClient::new(&fixture.env, &fixture.settlement)
        .notify(&fixture.hook, &notice(&fixture, 7, 30, 70));

    assert!(!fixture.check(20, 7));
}

#[test]
fn invalid_notice_rolls_back_without_releasing_budget() {
    let fixture = Fixture::new(100);
    assert!(fixture.check(70, 8));
    let mut wrong = notice(&fixture, 8, 30, 70);
    wrong.pay_to = Address::generate(&fixture.env);

    assert!(
        SettlementInvokerClient::new(&fixture.env, &fixture.settlement)
            .try_notify(&fixture.hook, &wrong)
            .is_err()
    );
    let client = ReconcilingPolicyClient::new(&fixture.env, &fixture.hook);
    assert_eq!(client.get_budget(&fixture.account, &0).committed, 70);
    assert_eq!(
        client
            .get_reservation(
                &fixture.account,
                &BytesN::from_array(&fixture.env, &[8; 32]),
            )
            .status,
        ReservationStatus::Pending,
    );
}

#[test]
fn missing_reservation_is_a_record_simulation_no_op() {
    let fixture = Fixture::new(100);
    SettlementInvokerClient::new(&fixture.env, &fixture.settlement)
        .notify(&fixture.hook, &notice(&fixture, 9, 0, 70));

    assert_eq!(
        ReconcilingPolicyClient::new(&fixture.env, &fixture.hook)
            .get_budget(&fixture.account, &0)
            .committed,
        0,
    );
}

#[test]
fn context_rule_rejects_a_different_settlement_contract() {
    let fixture = Fixture::new(100);
    let payload = BytesN::random(&fixture.env);
    let auth = auth_payload(
        &fixture.env,
        &fixture.key,
        &fixture.signer,
        &payload,
        vec![&fixture.env, 0u32, 1u32],
    );
    let context = settlement_context(
        &fixture.env,
        &Address::generate(&fixture.env),
        &fixture.pay_to,
        &fixture.token,
        50,
        100,
        &fixture.facilitator,
        &BytesN::from_array(&fixture.env, &[3; 32]),
        &fixture.hook,
    );
    assert!(fixture
        .env
        .try_invoke_contract_check_auth::<PolicyError>(
            &fixture.account,
            &payload,
            auth.into_val(&fixture.env),
            &vec![
                &fixture.env,
                context,
                approval_context(
                    &fixture.env,
                    &fixture.token,
                    &fixture.account,
                    &fixture.settlement,
                    50,
                    100,
                ),
            ],
        )
        .is_err());
}

#[test]
fn wrong_agent_signature_is_rejected() {
    let fixture = Fixture::new(100);
    let payload = BytesN::random(&fixture.env);
    let wrong_key = SigningKey::from_bytes(&[8; 32]);
    let auth = auth_payload(
        &fixture.env,
        &wrong_key,
        &fixture.signer,
        &payload,
        vec![&fixture.env, 0u32, 1u32],
    );
    let context = settlement_context(
        &fixture.env,
        &fixture.settlement,
        &fixture.pay_to,
        &fixture.token,
        50,
        100,
        &fixture.facilitator,
        &BytesN::from_array(&fixture.env, &[4; 32]),
        &fixture.hook,
    );
    assert!(fixture
        .env
        .try_invoke_contract_check_auth::<PolicyError>(
            &fixture.account,
            &payload,
            auth.into_val(&fixture.env),
            &vec![
                &fixture.env,
                context,
                approval_context(
                    &fixture.env,
                    &fixture.token,
                    &fixture.account,
                    &fixture.settlement,
                    50,
                    100,
                ),
            ],
        )
        .is_err());
}

#[test]
fn token_rule_cannot_authorize_a_standalone_approval() {
    let fixture = Fixture::new(100);
    let payload = BytesN::random(&fixture.env);
    let auth = auth_payload(
        &fixture.env,
        &fixture.key,
        &fixture.signer,
        &payload,
        vec![&fixture.env, 1u32],
    );
    let approval = approval_context(
        &fixture.env,
        &fixture.token,
        &fixture.account,
        &fixture.settlement,
        50,
        100,
    );

    assert!(fixture
        .env
        .try_invoke_contract_check_auth::<PolicyError>(
            &fixture.account,
            &payload,
            auth.into_val(&fixture.env),
            &vec![&fixture.env, approval],
        )
        .is_err());
}

#[test]
fn token_approval_must_match_the_settlement_reservation() {
    let fixture = Fixture::new(100);
    let payload = BytesN::random(&fixture.env);
    let auth = auth_payload(
        &fixture.env,
        &fixture.key,
        &fixture.signer,
        &payload,
        vec![&fixture.env, 0u32, 1u32],
    );
    let settlement = settlement_context(
        &fixture.env,
        &fixture.settlement,
        &fixture.pay_to,
        &fixture.token,
        70,
        100,
        &fixture.facilitator,
        &BytesN::from_array(&fixture.env, &[10; 32]),
        &fixture.hook,
    );
    let mismatched_approval = approval_context(
        &fixture.env,
        &fixture.token,
        &fixture.account,
        &fixture.settlement,
        69,
        100,
    );

    assert!(fixture
        .env
        .try_invoke_contract_check_auth::<PolicyError>(
            &fixture.account,
            &payload,
            auth.into_val(&fixture.env),
            &vec![&fixture.env, settlement, mismatched_approval],
        )
        .is_err());
    assert_eq!(
        ReconcilingPolicyClient::new(&fixture.env, &fixture.hook)
            .get_budget(&fixture.account, &0)
            .committed,
        0,
    );
}
