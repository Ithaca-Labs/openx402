extern crate std;

use super::{
    Settlement, SettlementError, SettlementNoticeV1, UptoSettlement, UptoSettlementClient,
};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short,
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger, MockAuth, MockAuthInvoke,
    },
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Error, IntoVal,
};

#[contracttype]
#[derive(Clone)]
enum MockTokenKey {
    Allowance(Address, Address),
    AdditiveApproval,
    Balance(Address),
    FailApprove,
    FailPull,
    FailTo,
}

#[contracttype]
#[derive(Clone)]
struct MockAllowance {
    amount: i128,
    expiration: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum MockTokenError {
    ForcedFailure = 100,
    InsufficientAllowance = 101,
    InsufficientBalance = 102,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum MockHookError {
    ForcedFailure = 200,
    DuplicateSettlement = 201,
    ReentrySucceeded = 202,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum MockHookMode {
    Record,
    Fail,
    MutateRecipient,
    Reenter,
}

#[contracttype]
#[derive(Clone)]
enum MockHookKey {
    Calls,
    Facilitator,
    LastNotice,
    Mode,
    ReentryRejected,
    Seen(Address, BytesN<32>),
}

#[contract]
struct MockSettlementHook;

#[contractimpl]
impl MockSettlementHook {
    pub fn configure(env: Env, mode: MockHookMode, facilitator: Address) {
        env.storage().instance().set(&MockHookKey::Mode, &mode);
        env.storage()
            .instance()
            .set(&MockHookKey::Facilitator, &facilitator);
    }

    pub fn calls(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&MockHookKey::Calls)
            .unwrap_or(0)
    }

    pub fn last_notice(env: Env) -> Option<SettlementNoticeV1> {
        env.storage().instance().get(&MockHookKey::LastNotice)
    }

    pub fn reentry_rejected(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&MockHookKey::ReentryRejected)
            .unwrap_or(false)
    }

    pub fn on_settled_v1(env: Env, notice: SettlementNoticeV1, caller: Address) {
        caller.require_auth();

        let seen_key = MockHookKey::Seen(notice.payer.clone(), notice.settlement_id.clone());
        if env.storage().persistent().has(&seen_key) {
            panic_with_error!(&env, MockHookError::DuplicateSettlement);
        }

        let mode: MockHookMode = env
            .storage()
            .instance()
            .get(&MockHookKey::Mode)
            .unwrap_or(MockHookMode::Record);
        match mode {
            MockHookMode::Fail => panic_with_error!(&env, MockHookError::ForcedFailure),
            MockHookMode::MutateRecipient => {
                TokenClient::new(&env, &notice.token).transfer(
                    &env.current_contract_address(),
                    &notice.pay_to,
                    &1,
                );
            }
            MockHookMode::Reenter => {
                let facilitator: Address = env
                    .storage()
                    .instance()
                    .get(&MockHookKey::Facilitator)
                    .unwrap();
                let current = env.ledger().sequence();
                let reentry = UptoSettlementClient::new(&env, &caller).try_settle(
                    &notice.payer,
                    &notice.pay_to,
                    &notice.token,
                    &notice.max_amount,
                    &current,
                    &(current + 1),
                    &facilitator,
                    &settlement_id(&env, 255),
                    &None,
                    &0,
                );
                if reentry.is_ok() {
                    panic_with_error!(&env, MockHookError::ReentrySucceeded);
                }
                env.storage()
                    .instance()
                    .set(&MockHookKey::ReentryRejected, &true);
            }
            MockHookMode::Record => {}
        }

        let calls = Self::calls(env.clone()) + 1;
        env.storage().instance().set(&MockHookKey::Calls, &calls);
        env.storage()
            .instance()
            .set(&MockHookKey::LastNotice, &notice);
        env.storage().persistent().set(&seen_key, &());
    }
}

#[contract]
struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn __constructor(env: Env, owner: Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&MockTokenKey::Balance(owner), &amount);
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let allowance: Option<MockAllowance> = env
            .storage()
            .persistent()
            .get(&MockTokenKey::Allowance(from, spender));
        allowance
            .filter(|value| value.expiration >= env.ledger().sequence())
            .map(|value| value.amount)
            .unwrap_or(0)
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MockTokenKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        if env
            .storage()
            .instance()
            .get(&MockTokenKey::FailApprove)
            .unwrap_or(false)
        {
            panic_with_error!(&env, MockTokenError::ForcedFailure);
        }

        let additive = env
            .storage()
            .instance()
            .get(&MockTokenKey::AdditiveApproval)
            .unwrap_or(false);
        let amount = if additive {
            amount
                .checked_add(Self::allowance(env.clone(), from.clone(), spender.clone()))
                .unwrap()
        } else {
            amount
        };
        env.storage().persistent().set(
            &MockTokenKey::Allowance(from, spender),
            &MockAllowance {
                amount,
                expiration: expiration_ledger,
            },
        );
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if env
            .storage()
            .instance()
            .get(&MockTokenKey::FailPull)
            .unwrap_or(false)
        {
            panic_with_error!(&env, MockTokenError::ForcedFailure);
        }

        let key = MockTokenKey::Allowance(from.clone(), spender);
        let mut allowance: MockAllowance = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, MockTokenError::InsufficientAllowance));
        if allowance.expiration < env.ledger().sequence() || allowance.amount < amount {
            panic_with_error!(&env, MockTokenError::InsufficientAllowance);
        }
        allowance.amount -= amount;
        env.storage().persistent().set(&key, &allowance);
        move_balance(&env, &from, &to, amount);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if env
            .storage()
            .instance()
            .get::<_, Option<Address>>(&MockTokenKey::FailTo)
            .flatten()
            == Some(to.clone())
        {
            panic_with_error!(&env, MockTokenError::ForcedFailure);
        }
        move_balance(&env, &from, &to, amount);
    }

    pub fn decimals(_env: Env) -> u32 {
        6
    }

    pub fn set_additive_approval(env: Env, enabled: bool) {
        env.storage()
            .instance()
            .set(&MockTokenKey::AdditiveApproval, &enabled);
    }

    pub fn set_fail_approve(env: Env, enabled: bool) {
        env.storage()
            .instance()
            .set(&MockTokenKey::FailApprove, &enabled);
    }

    pub fn set_fail_pull(env: Env, enabled: bool) {
        env.storage()
            .instance()
            .set(&MockTokenKey::FailPull, &enabled);
    }

    pub fn set_fail_to(env: Env, to: Option<Address>) {
        env.storage().instance().set(&MockTokenKey::FailTo, &to);
    }
}

fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) {
    let from_key = MockTokenKey::Balance(from.clone());
    let to_key = MockTokenKey::Balance(to.clone());
    let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
    if from_balance < amount {
        panic_with_error!(env, MockTokenError::InsufficientBalance);
    }
    let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
    env.storage()
        .persistent()
        .set(&from_key, &(from_balance - amount));
    env.storage()
        .persistent()
        .set(&to_key, &(to_balance + amount));
}

struct Fixture {
    env: Env,
    contract: Address,
    payer: Address,
    payee: Address,
    facilitator: Address,
    token: Address,
    settlement_id: BytesN<32>,
}

struct MockFixture {
    env: Env,
    contract: Address,
    payer: Address,
    payee: Address,
    facilitator: Address,
    token: Address,
    settlement_id: BytesN<32>,
}

fn settlement_id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

impl MockFixture {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().set_sequence_number(100);
        env.mock_all_auths();
        let contract = env.register(UptoSettlement, ());
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let facilitator = Address::generate(&env);
        let token = env.register(MockToken, (payer.clone(), 1_000i128));
        let settlement_id = settlement_id(&env, 1);
        Self {
            env,
            contract,
            payer,
            payee,
            facilitator,
            token,
            settlement_id,
        }
    }

    fn settle(&self) -> Settlement {
        UptoSettlementClient::new(&self.env, &self.contract).settle(
            &self.payer,
            &self.payee,
            &self.token,
            &100,
            &100,
            &120,
            &self.facilitator,
            &self.settlement_id,
            &None,
            &30,
        )
    }

    fn settlement_fails(&self) -> bool {
        UptoSettlementClient::new(&self.env, &self.contract)
            .try_settle(
                &self.payer,
                &self.payee,
                &self.token,
                &100,
                &100,
                &120,
                &self.facilitator,
                &self.settlement_id,
                &None,
                &30,
            )
            .is_err()
    }

    fn state(&self) -> (i128, i128, i128, i128) {
        let token = MockTokenClient::new(&self.env, &self.token);
        (
            token.balance(&self.payer),
            token.balance(&self.payee),
            token.balance(&self.contract),
            token.allowance(&self.payer, &self.contract),
        )
    }
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().set_sequence_number(100);
        env.mock_all_auths();

        let contract = env.register(UptoSettlement, ());
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let facilitator = Address::generate(&env);
        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token = sac.address();
        StellarAssetClient::new(&env, &token).mint(&payer, &1_000);
        let settlement_id = settlement_id(&env, 1);

        Self {
            env,
            contract,
            payer,
            payee,
            facilitator,
            token,
            settlement_id,
        }
    }

    fn settle(&self, actual: i128) -> Settlement {
        self.settle_with(actual, self.settlement_id.clone(), None)
    }

    fn settle_with(
        &self,
        actual: i128,
        settlement_id: BytesN<32>,
        settlement_hook: Option<Address>,
    ) -> Settlement {
        UptoSettlementClient::new(&self.env, &self.contract).settle(
            &self.payer,
            &self.payee,
            &self.token,
            &100,
            &100,
            &120,
            &self.facilitator,
            &settlement_id,
            &settlement_hook,
            &actual,
        )
    }

    fn balances(&self) -> (i128, i128, i128, i128) {
        let token = TokenClient::new(&self.env, &self.token);
        (
            token.balance(&self.payer),
            token.balance(&self.payee),
            token.balance(&self.contract),
            token.allowance(&self.payer, &self.contract),
        )
    }
}

#[test]
fn settles_below_maximum_and_consumes_allowance() {
    let f = Fixture::new();

    assert_eq!(
        f.settle(30),
        Settlement {
            actual: 30,
            maximum: 100
        }
    );

    let auths = f.env.auths();
    assert_eq!(
        auths,
        [
            (
                f.payer.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        f.contract.clone(),
                        symbol_short!("settle"),
                        (
                            f.payee.clone(),
                            f.token.clone(),
                            100i128,
                            100u32,
                            120u32,
                            f.facilitator.clone(),
                            f.settlement_id.clone(),
                            Option::<Address>::None,
                        )
                            .into_val(&f.env),
                    )),
                    sub_invocations: std::vec![AuthorizedInvocation {
                        function: AuthorizedFunction::Contract((
                            f.token.clone(),
                            symbol_short!("approve"),
                            (f.payer.clone(), f.contract.clone(), 100i128, 120u32,)
                                .into_val(&f.env),
                        )),
                        sub_invocations: std::vec![],
                    }],
                },
            ),
            (
                f.facilitator.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        f.contract.clone(),
                        symbol_short!("settle"),
                        (
                            f.payer.clone(),
                            f.payee.clone(),
                            f.token.clone(),
                            100i128,
                            100u32,
                            120u32,
                            f.facilitator.clone(),
                            f.settlement_id.clone(),
                            Option::<Address>::None,
                            30i128,
                        )
                            .into_val(&f.env),
                    )),
                    sub_invocations: std::vec![],
                },
            ),
        ]
    );
    assert_eq!(f.balances(), (970, 30, 0, 0));
}

#[test]
fn zero_settlement_is_onchain_terminal_work() {
    let f = Fixture::new();

    assert_eq!(
        f.settle(0),
        Settlement {
            actual: 0,
            maximum: 100
        }
    );
    assert_eq!(f.env.auths().len(), 2);
    assert_eq!(f.balances(), (1_000, 0, 0, 0));
}

#[test]
fn hook_runs_for_zero_and_partial_settlements() {
    let f = Fixture::new();
    let hook = f.env.register(MockSettlementHook, ());
    let hook_client = MockSettlementHookClient::new(&f.env, &hook);
    hook_client.configure(&MockHookMode::Record, &f.facilitator);

    f.settle_with(0, settlement_id(&f.env, 2), Some(hook.clone()));
    assert_eq!(hook_client.calls(), 1);
    assert_eq!(
        hook_client.last_notice(),
        Some(SettlementNoticeV1 {
            actual: 0,
            max_amount: 100,
            pay_to: f.payee.clone(),
            payer: f.payer.clone(),
            settlement_id: settlement_id(&f.env, 2),
            token: f.token.clone(),
        })
    );

    f.settle_with(30, settlement_id(&f.env, 3), Some(hook));
    assert_eq!(hook_client.calls(), 2);
    assert_eq!(f.balances(), (970, 30, 0, 0));
}

#[test]
fn direct_hook_notice_without_settlement_caller_auth_is_rejected() {
    let env = Env::default();
    let hook = env.register(MockSettlementHook, ());
    let alleged_caller = Address::generate(&env);
    let notice = SettlementNoticeV1 {
        actual: 10,
        max_amount: 100,
        pay_to: Address::generate(&env),
        payer: Address::generate(&env),
        settlement_id: settlement_id(&env, 10),
        token: Address::generate(&env),
    };

    assert!(MockSettlementHookClient::new(&env, &hook)
        .try_on_settled_v1(&notice, &alleged_caller)
        .is_err());
}

#[test]
fn duplicate_payer_and_settlement_id_is_rejected_atomically() {
    let f = Fixture::new();
    let hook = f.env.register(MockSettlementHook, ());
    let hook_client = MockSettlementHookClient::new(&f.env, &hook);
    hook_client.configure(&MockHookMode::Record, &f.facilitator);
    let id = settlement_id(&f.env, 4);

    f.settle_with(10, id.clone(), Some(hook.clone()));
    assert!(UptoSettlementClient::new(&f.env, &f.contract)
        .try_settle(
            &f.payer,
            &f.payee,
            &f.token,
            &100,
            &100,
            &120,
            &f.facilitator,
            &id,
            &Some(hook.clone()),
            &20,
        )
        .is_err());
    assert_eq!(hook_client.calls(), 1);
    assert_eq!(f.balances(), (990, 10, 0, 0));
}

#[test]
fn hook_failure_reverts_the_entire_settlement() {
    let f = Fixture::new();
    let hook = f.env.register(MockSettlementHook, ());
    MockSettlementHookClient::new(&f.env, &hook).configure(&MockHookMode::Fail, &f.facilitator);

    assert!(UptoSettlementClient::new(&f.env, &f.contract)
        .try_settle(
            &f.payer,
            &f.payee,
            &f.token,
            &100,
            &100,
            &120,
            &f.facilitator,
            &settlement_id(&f.env, 5),
            &Some(hook),
            &30,
        )
        .is_err());
    assert_eq!(f.balances(), (1_000, 0, 0, 0));
}

#[test]
fn post_hook_invariants_reject_recipient_balance_mutation() {
    let f = Fixture::new();
    let hook = f.env.register(MockSettlementHook, ());
    MockSettlementHookClient::new(&f.env, &hook)
        .configure(&MockHookMode::MutateRecipient, &f.facilitator);
    TokenClient::new(&f.env, &f.token).transfer(&f.payer, &hook, &1);
    assert_eq!(f.balances(), (999, 0, 0, 0));

    assert!(UptoSettlementClient::new(&f.env, &f.contract)
        .try_settle(
            &f.payer,
            &f.payee,
            &f.token,
            &100,
            &100,
            &120,
            &f.facilitator,
            &settlement_id(&f.env, 6),
            &Some(hook.clone()),
            &30,
        )
        .is_err());
    assert_eq!(f.balances(), (999, 0, 0, 0));
    assert_eq!(TokenClient::new(&f.env, &f.token).balance(&hook), 1);
}

#[test]
fn missing_hook_interface_is_the_payers_atomic_failure() {
    let f = Fixture::new();
    let missing_hook = Address::generate(&f.env);

    assert!(UptoSettlementClient::new(&f.env, &f.contract)
        .try_settle(
            &f.payer,
            &f.payee,
            &f.token,
            &100,
            &100,
            &120,
            &f.facilitator,
            &settlement_id(&f.env, 7),
            &Some(missing_hook),
            &30,
        )
        .is_err());
    assert_eq!(f.balances(), (1_000, 0, 0, 0));
}

#[test]
fn settlement_contract_and_token_are_invalid_hooks() {
    for use_token in [false, true] {
        let f = Fixture::new();
        let hook = if use_token {
            f.token.clone()
        } else {
            f.contract.clone()
        };
        let result = UptoSettlementClient::new(&f.env, &f.contract).try_settle(
            &f.payer,
            &f.payee,
            &f.token,
            &100,
            &100,
            &120,
            &f.facilitator,
            &settlement_id(&f.env, 8),
            &Some(hook),
            &30,
        );
        assert_eq!(
            result,
            Err(Ok(Error::from_contract_error(
                SettlementError::InvalidSettlementHook as u32
            )))
        );
        assert_eq!(f.balances(), (1_000, 0, 0, 0));
    }
}

#[test]
fn hook_reentry_with_the_original_payer_is_not_in_the_auth_tree() {
    let env = Env::default();
    env.ledger().set_sequence_number(100);
    let contract = env.register(UptoSettlement, ());
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let facilitator = Address::generate(&env);
    let token = env.register(MockToken, (payer.clone(), 1_000i128));
    let hook = env.register(MockSettlementHook, ());
    let id = settlement_id(&env, 9);
    MockSettlementHookClient::new(&env, &hook).configure(&MockHookMode::Reenter, &facilitator);

    let approve = MockAuthInvoke {
        contract: &token,
        fn_name: "approve",
        args: (&payer, &contract, 100i128, 120u32).into_val(&env),
        sub_invokes: &[],
    };
    let payer_invoke = MockAuthInvoke {
        contract: &contract,
        fn_name: "settle",
        args: (
            &payee,
            &token,
            100i128,
            100u32,
            120u32,
            &facilitator,
            &id,
            Some(hook.clone()),
        )
            .into_val(&env),
        sub_invokes: &[approve],
    };
    let facilitator_invoke = MockAuthInvoke {
        contract: &contract,
        fn_name: "settle",
        args: (
            &payer,
            &payee,
            &token,
            100i128,
            100u32,
            120u32,
            &facilitator,
            &id,
            Some(hook.clone()),
            30i128,
        )
            .into_val(&env),
        sub_invokes: &[],
    };

    UptoSettlementClient::new(&env, &contract)
        .mock_auths(&[
            MockAuth {
                address: &payer,
                invoke: &payer_invoke,
            },
            MockAuth {
                address: &facilitator,
                invoke: &facilitator_invoke,
            },
        ])
        .settle(
            &payer,
            &payee,
            &token,
            &100,
            &100,
            &120,
            &facilitator,
            &id,
            &Some(hook.clone()),
            &30,
        );

    assert!(MockSettlementHookClient::new(&env, &hook).reentry_rejected());
    let token = MockTokenClient::new(&env, &token);
    assert_eq!(token.balance(&payer), 970);
    assert_eq!(token.balance(&payee), 30);
    assert_eq!(token.balance(&contract), 0);
    assert_eq!(token.allowance(&payer, &contract), 0);
}

#[test]
fn settles_full_maximum() {
    let f = Fixture::new();

    f.settle(100);
    assert_eq!(f.balances(), (900, 100, 0, 0));
}

#[test]
fn payer_may_equal_recipient_without_breaking_balance_checks() {
    let f = Fixture::new();
    let client = UptoSettlementClient::new(&f.env, &f.contract);

    client.settle(
        &f.payer,
        &f.payer,
        &f.token,
        &100,
        &100,
        &120,
        &f.facilitator,
        &f.settlement_id,
        &None,
        &30,
    );
    let token = TokenClient::new(&f.env, &f.token);
    assert_eq!(token.balance(&f.payer), 1_000);
    assert_eq!(token.balance(&f.contract), 0);
    assert_eq!(token.allowance(&f.payer, &f.contract), 0);
}

#[test]
fn preexisting_larger_allowance_is_overwritten_and_consumed() {
    let f = Fixture::new();
    let token = TokenClient::new(&f.env, &f.token);
    token.approve(&f.payer, &f.contract, &500, &120);

    f.settle(30);
    assert_eq!(f.balances(), (970, 30, 0, 0));
}

#[test]
fn validity_bounds_are_inclusive() {
    let f = Fixture::new();
    f.settle(1);

    let f = Fixture::new();
    f.env.ledger().set_sequence_number(120);
    f.settle(1);
}

#[test]
fn rejects_all_invalid_amounts_and_windows() {
    let cases = [
        (0, 0, 100, 120, SettlementError::InvalidMaximum),
        (-1, 0, 100, 120, SettlementError::InvalidMaximum),
        (100, -1, 100, 120, SettlementError::NegativeActual),
        (100, 101, 100, 120, SettlementError::ActualExceedsMaximum),
        (100, 1, 121, 120, SettlementError::InvalidTimeWindow),
        (100, 1, 101, 120, SettlementError::NotYetValid),
        (100, 1, 80, 99, SettlementError::Expired),
    ];

    for (maximum, actual, valid_after, deadline, expected) in cases {
        let f = Fixture::new();
        let result = UptoSettlementClient::new(&f.env, &f.contract).try_settle(
            &f.payer,
            &f.payee,
            &f.token,
            &maximum,
            &valid_after,
            &deadline,
            &f.facilitator,
            &f.settlement_id,
            &None,
            &actual,
        );
        assert_eq!(result, Err(Ok(Error::from_contract_error(expected as u32))));
        assert_eq!(f.balances(), (1_000, 0, 0, 0));
    }
}

#[test]
fn rejects_facilitator_as_payer_atomically() {
    let f = Fixture::new();
    let result = UptoSettlementClient::new(&f.env, &f.contract).try_settle(
        &f.facilitator,
        &f.payee,
        &f.token,
        &100,
        &100,
        &120,
        &f.facilitator,
        &f.settlement_id,
        &None,
        &1,
    );

    assert_eq!(
        result,
        Err(Ok(Error::from_contract_error(
            SettlementError::InvalidPayer as u32
        )))
    );
    assert_eq!(f.balances(), (1_000, 0, 0, 0));
}

#[test]
fn insufficient_balance_rolls_back_approval_and_transfers() {
    let f = Fixture::new();
    let result = UptoSettlementClient::new(&f.env, &f.contract).try_settle(
        &f.payer,
        &f.payee,
        &f.token,
        &1_001,
        &100,
        &120,
        &f.facilitator,
        &f.settlement_id,
        &None,
        &1,
    );

    assert!(result.is_err());
    assert_eq!(f.balances(), (1_000, 0, 0, 0));
}

#[test]
fn i128_max_fails_without_partial_state() {
    let f = Fixture::new();
    let result = UptoSettlementClient::new(&f.env, &f.contract).try_settle(
        &f.payer,
        &f.payee,
        &f.token,
        &i128::MAX,
        &100,
        &120,
        &f.facilitator,
        &f.settlement_id,
        &None,
        &i128::MAX,
    );

    assert!(result.is_err());
    assert_eq!(f.balances(), (1_000, 0, 0, 0));
}

#[test]
fn every_actual_from_zero_through_maximum_preserves_invariants() {
    for actual in 0..=100 {
        let f = Fixture::new();
        f.settle(actual);
        assert_eq!(f.balances(), (1_000 - actual, actual, 0, 0));
    }
}

#[test]
fn ordinary_six_decimal_sep41_token_settles() {
    let f = MockFixture::new();
    assert_eq!(
        f.settle(),
        Settlement {
            actual: 30,
            maximum: 100
        }
    );
    assert_eq!(f.state(), (970, 30, 0, 0));
    assert_eq!(MockTokenClient::new(&f.env, &f.token).decimals(), 6);
}

#[test]
fn approval_failure_is_atomic() {
    let f = MockFixture::new();
    MockTokenClient::new(&f.env, &f.token).set_fail_approve(&true);
    assert!(f.settlement_fails());
    assert_eq!(f.state(), (1_000, 0, 0, 0));
}

#[test]
fn pull_failure_rolls_back_approval() {
    let f = MockFixture::new();
    MockTokenClient::new(&f.env, &f.token).set_fail_pull(&true);
    assert!(f.settlement_fails());
    assert_eq!(f.state(), (1_000, 0, 0, 0));
}

#[test]
fn recipient_transfer_failure_rolls_back_pull_and_approval() {
    let f = MockFixture::new();
    MockTokenClient::new(&f.env, &f.token).set_fail_to(&Some(f.payee.clone()));
    assert!(f.settlement_fails());
    assert_eq!(f.state(), (1_000, 0, 0, 0));
}

#[test]
fn refund_failure_rolls_back_payment_pull_and_approval() {
    let f = MockFixture::new();
    MockTokenClient::new(&f.env, &f.token).set_fail_to(&Some(f.payer.clone()));
    assert!(f.settlement_fails());
    assert_eq!(f.state(), (1_000, 0, 0, 0));
}

#[test]
fn additive_approval_token_is_rejected_without_mutating_prior_allowance() {
    let f = MockFixture::new();
    let token = MockTokenClient::new(&f.env, &f.token);
    token.approve(&f.payer, &f.contract, &500, &120);
    token.set_additive_approval(&true);

    assert!(f.settlement_fails());
    assert_eq!(f.state(), (1_000, 0, 0, 500));
}
