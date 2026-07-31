#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
    Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, ContextRuleType, Signer},
};

const DAY_IN_LEDGERS: u32 = 17_280;
const STORAGE_TTL: u32 = 120 * DAY_IN_LEDGERS;
const STORAGE_THRESHOLD: u32 = STORAGE_TTL - DAY_IN_LEDGERS;

#[contract]
pub struct ReconcilingPolicy;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BudgetParams {
    pub limit: i128,
    pub period_ledgers: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenApprovalParams {
    pub settlement: Address,
    pub settlement_rule_id: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PolicyParams {
    Settlement(BudgetParams),
    TokenApproval(TokenApprovalParams),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BudgetState {
    pub committed: i128,
    pub limit: i128,
    pub period_ledgers: u32,
    pub window_start: u32,
}

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
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReservationStatus {
    Pending,
    Settled(i128),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reservation {
    pub deadline: u32,
    pub max_amount: i128,
    pub pay_to: Address,
    pub rule_id: u32,
    pub settlement: Address,
    pub status: ReservationStatus,
    pub token: Address,
}

#[contracttype]
enum StorageKey {
    Active(Address),
    Budget(Address, u32),
    Reservation(Address, BytesN<32>),
    TokenRule(Address, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PolicyError {
    NotInstalled = 3300,
    AlreadyInstalled = 3301,
    InvalidConfiguration = 3302,
    InvalidContextRule = 3303,
    InvalidSettlementCall = 3304,
    NoAuthenticatedSigner = 3305,
    BudgetExceeded = 3306,
    DuplicateSettlementId = 3307,
    ReservationNotFound = 3308,
    ReservationAlreadySettled = 3309,
    InvalidNotice = 3310,
    UnauthorizedSettlement = 3311,
    ArithmeticOverflow = 3312,
    MissingSettlementContext = 3313,
}

#[contractimpl]
impl Policy for ReconcilingPolicy {
    type AccountParams = PolicyParams;

    fn enforce(
        env: &Env,
        context: Context,
        authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        if authenticated_signers.is_empty() {
            panic_with_error!(env, PolicyError::NoAuthenticatedSigner);
        }

        let target = match &context_rule.context_type {
            ContextRuleType::CallContract(address) => address.clone(),
            _ => panic_with_error!(env, PolicyError::InvalidContextRule),
        };
        let ContractContext {
            contract,
            fn_name,
            args,
        } = match context {
            Context::Contract(context) => context,
            _ => panic_with_error!(env, PolicyError::InvalidSettlementCall),
        };
        if contract != target {
            panic_with_error!(env, PolicyError::InvalidContextRule);
        }

        let token_rule_key = StorageKey::TokenRule(smart_account.clone(), context_rule.id);
        if let Some(token_params) = env.storage().persistent().get(&token_rule_key) {
            enforce_token_approval(env, &smart_account, &target, &fn_name, &args, &token_params);
            extend(env, &token_rule_key);
            return;
        }

        if fn_name != Symbol::new(env, "settle") || args.len() != 8 {
            panic_with_error!(env, PolicyError::InvalidSettlementCall);
        }

        let pay_to = parse_arg::<Address>(env, &args, 0);
        let token = parse_arg::<Address>(env, &args, 1);
        let max_amount = parse_arg::<i128>(env, &args, 2);
        let deadline = parse_arg::<u32>(env, &args, 4);
        let settlement_id = parse_arg::<BytesN<32>>(env, &args, 6);
        let hook = parse_arg::<Option<Address>>(env, &args, 7);
        if max_amount <= 0 || hook != Some(env.current_contract_address()) {
            panic_with_error!(env, PolicyError::InvalidSettlementCall);
        }

        let reservation_key = StorageKey::Reservation(smart_account.clone(), settlement_id.clone());
        if env.storage().persistent().has(&reservation_key) {
            panic_with_error!(env, PolicyError::DuplicateSettlementId);
        }

        let budget_key = StorageKey::Budget(smart_account.clone(), context_rule.id);
        let mut budget = get_budget_internal(env, &budget_key);
        refresh_window(env, &mut budget);
        budget.committed = budget
            .committed
            .checked_add(max_amount)
            .unwrap_or_else(|| panic_with_error!(env, PolicyError::ArithmeticOverflow));
        if budget.committed > budget.limit {
            panic_with_error!(env, PolicyError::BudgetExceeded);
        }

        env.storage().persistent().set(&budget_key, &budget);
        env.storage().persistent().set(
            &reservation_key,
            &Reservation {
                deadline,
                max_amount,
                pay_to,
                rule_id: context_rule.id,
                settlement: target,
                status: ReservationStatus::Pending,
                token,
            },
        );
        env.storage()
            .temporary()
            .set(&StorageKey::Active(smart_account), &settlement_id);
        extend(env, &budget_key);
        extend(env, &reservation_key);
    }

    fn install(
        env: &Env,
        params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        match params {
            PolicyParams::Settlement(budget) => {
                if budget.limit <= 0
                    || budget.period_ledgers == 0
                    || !matches!(context_rule.context_type, ContextRuleType::CallContract(_))
                {
                    panic_with_error!(env, PolicyError::InvalidConfiguration);
                }
                let key = StorageKey::Budget(smart_account, context_rule.id);
                if env.storage().persistent().has(&key) {
                    panic_with_error!(env, PolicyError::AlreadyInstalled);
                }
                env.storage().persistent().set(
                    &key,
                    &BudgetState {
                        committed: 0,
                        limit: budget.limit,
                        period_ledgers: budget.period_ledgers,
                        window_start: env.ledger().sequence(),
                    },
                );
                extend(env, &key);
            }
            PolicyParams::TokenApproval(token_params) => {
                if !matches!(context_rule.context_type, ContextRuleType::CallContract(_))
                    || !env.storage().persistent().has(&StorageKey::Budget(
                        smart_account.clone(),
                        token_params.settlement_rule_id,
                    ))
                {
                    panic_with_error!(env, PolicyError::InvalidConfiguration);
                }
                let key = StorageKey::TokenRule(smart_account, context_rule.id);
                if env.storage().persistent().has(&key) {
                    panic_with_error!(env, PolicyError::AlreadyInstalled);
                }
                env.storage().persistent().set(&key, &token_params);
                extend(env, &key);
            }
        }
    }

    fn uninstall(env: &Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        let key = StorageKey::Budget(smart_account.clone(), context_rule.id);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().remove(&key);
            return;
        }
        let token_key = StorageKey::TokenRule(smart_account, context_rule.id);
        if env.storage().persistent().has(&token_key) {
            env.storage().persistent().remove(&token_key);
            return;
        }
        panic_with_error!(env, PolicyError::NotInstalled);
    }
}

#[contractimpl]
impl ReconcilingPolicy {
    pub fn on_settled_v1(env: Env, notice: SettlementNoticeV1, caller: Address) {
        let key = StorageKey::Reservation(notice.payer.clone(), notice.settlement_id.clone());
        let Some(mut reservation): Option<Reservation> = env.storage().persistent().get(&key)
        else {
            // Recording simulation executes the hook but skips __check_auth, so the
            // reservation does not exist until enforcing simulation or execution.
            // With no reservation there is no policy state to release.
            return;
        };

        if !matches!(reservation.status, ReservationStatus::Pending) {
            panic_with_error!(&env, PolicyError::ReservationAlreadySettled);
        }
        if caller != reservation.settlement {
            panic_with_error!(&env, PolicyError::UnauthorizedSettlement);
        }
        caller.require_auth();
        if notice.max_amount != reservation.max_amount
            || notice.pay_to != reservation.pay_to
            || notice.token != reservation.token
            || notice.actual < 0
            || notice.actual > notice.max_amount
        {
            panic_with_error!(&env, PolicyError::InvalidNotice);
        }

        let budget_key = StorageKey::Budget(notice.payer.clone(), reservation.rule_id);
        let mut budget = get_budget_internal(&env, &budget_key);
        let release = notice
            .max_amount
            .checked_sub(notice.actual)
            .unwrap_or_else(|| panic_with_error!(&env, PolicyError::ArithmeticOverflow));
        budget.committed = budget
            .committed
            .checked_sub(release)
            .unwrap_or_else(|| panic_with_error!(&env, PolicyError::ArithmeticOverflow));
        reservation.status = ReservationStatus::Settled(notice.actual);

        env.storage().persistent().set(&budget_key, &budget);
        env.storage().persistent().set(&key, &reservation);
        env.storage()
            .temporary()
            .remove(&StorageKey::Active(notice.payer));
        extend(&env, &budget_key);
        extend(&env, &key);
    }

    pub fn get_budget(env: Env, smart_account: Address, rule_id: u32) -> BudgetState {
        get_budget_internal(&env, &StorageKey::Budget(smart_account, rule_id))
    }

    pub fn get_reservation(
        env: Env,
        smart_account: Address,
        settlement_id: BytesN<32>,
    ) -> Reservation {
        env.storage()
            .persistent()
            .get(&StorageKey::Reservation(smart_account, settlement_id))
            .unwrap_or_else(|| panic_with_error!(&env, PolicyError::ReservationNotFound))
    }
}

fn parse_arg<T>(env: &Env, args: &Vec<Val>, index: u32) -> T
where
    T: TryFromVal<Env, Val>,
{
    args.get(index)
        .and_then(|value| T::try_from_val(env, &value).ok())
        .unwrap_or_else(|| panic_with_error!(env, PolicyError::InvalidSettlementCall))
}

fn enforce_token_approval(
    env: &Env,
    smart_account: &Address,
    token: &Address,
    fn_name: &Symbol,
    args: &Vec<Val>,
    params: &TokenApprovalParams,
) {
    if fn_name != &Symbol::new(env, "approve") || args.len() != 4 {
        panic_with_error!(env, PolicyError::InvalidSettlementCall);
    }
    let from = parse_arg::<Address>(env, args, 0);
    let spender = parse_arg::<Address>(env, args, 1);
    let amount = parse_arg::<i128>(env, args, 2);
    let expiration = parse_arg::<u32>(env, args, 3);
    if from != *smart_account || spender != params.settlement {
        panic_with_error!(env, PolicyError::InvalidSettlementCall);
    }

    let active_key = StorageKey::Active(smart_account.clone());
    let settlement_id: BytesN<32> = env
        .storage()
        .temporary()
        .get(&active_key)
        .unwrap_or_else(|| panic_with_error!(env, PolicyError::MissingSettlementContext));
    let reservation: Reservation = env
        .storage()
        .persistent()
        .get(&StorageKey::Reservation(
            smart_account.clone(),
            settlement_id,
        ))
        .unwrap_or_else(|| panic_with_error!(env, PolicyError::ReservationNotFound));
    if reservation.rule_id != params.settlement_rule_id
        || reservation.settlement != params.settlement
        || reservation.token != *token
        || reservation.max_amount != amount
        || reservation.deadline != expiration
        || !matches!(reservation.status, ReservationStatus::Pending)
    {
        panic_with_error!(env, PolicyError::InvalidSettlementCall);
    }
}

fn get_budget_internal(env: &Env, key: &StorageKey) -> BudgetState {
    env.storage()
        .persistent()
        .get(key)
        .unwrap_or_else(|| panic_with_error!(env, PolicyError::NotInstalled))
}

fn refresh_window(env: &Env, budget: &mut BudgetState) {
    let elapsed = env.ledger().sequence().saturating_sub(budget.window_start);
    if elapsed >= budget.period_ledgers {
        budget.window_start = env.ledger().sequence();
        budget.committed = 0;
    }
}

fn extend(env: &Env, key: &StorageKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, STORAGE_THRESHOLD, STORAGE_TTL);
}
