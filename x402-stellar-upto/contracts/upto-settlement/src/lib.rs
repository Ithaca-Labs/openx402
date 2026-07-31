#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, IntoVal,
};

#[contract]
pub struct UptoSettlement;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SettlementError {
    InvalidMaximum = 1,
    NegativeActual = 2,
    ActualExceedsMaximum = 3,
    InvalidTimeWindow = 4,
    NotYetValid = 5,
    Expired = 6,
    InvalidPayer = 7,
    InvalidRecipient = 8,
    InvalidToken = 9,
    UnexpectedAllowance = 10,
    AllowanceNotConsumed = 11,
    BalanceInvariantFailed = 12,
    ArithmeticOverflow = 13,
    InvalidSettlementHook = 14,
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

#[contractclient(name = "SettlementHookClient")]
pub trait SettlementHook {
    fn on_settled_v1(env: &Env, notice: SettlementNoticeV1, caller: Address);
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    pub actual: i128,
    pub maximum: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settled {
    #[topic]
    pub payer: Address,
    #[topic]
    pub pay_to: Address,
    #[topic]
    pub token: Address,
    pub facilitator: Address,
    pub actual: i128,
    pub maximum: i128,
    pub settlement_id: BytesN<32>,
    pub settlement_hook: Option<Address>,
}

#[contractimpl]
impl UptoSettlement {
    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        env: Env,
        payer: Address,
        pay_to: Address,
        token: Address,
        max_amount: i128,
        valid_after: u32,
        deadline: u32,
        facilitator: Address,
        settlement_id: BytesN<32>,
        settlement_hook: Option<Address>,
        actual: i128,
    ) -> Settlement {
        validate(
            &env,
            &payer,
            &pay_to,
            &token,
            max_amount,
            valid_after,
            deadline,
            &facilitator,
            &settlement_hook,
            actual,
        );

        payer.require_auth_for_args(
            (
                pay_to.clone(),
                token.clone(),
                max_amount,
                valid_after,
                deadline,
                facilitator.clone(),
                settlement_id.clone(),
                settlement_hook.clone(),
            )
                .into_val(&env),
        );
        facilitator.require_auth();

        let contract = env.current_contract_address();
        let token_client = token::TokenClient::new(&env, &token);
        let payer_before = token_client.balance(&payer);
        let payee_before = token_client.balance(&pay_to);
        let contract_before = token_client.balance(&contract);

        token_client.approve(&payer, &contract, &max_amount, &deadline);
        if token_client.allowance(&payer, &contract) != max_amount {
            panic_with_error!(&env, SettlementError::UnexpectedAllowance);
        }

        token_client.transfer_from(&contract, &payer, &contract, &max_amount);

        if actual > 0 {
            token_client.transfer(&contract, &pay_to, &actual);
        }
        let refund = max_amount
            .checked_sub(actual)
            .unwrap_or_else(|| panic_with_error!(&env, SettlementError::ArithmeticOverflow));
        if refund > 0 {
            token_client.transfer(&contract, &payer, &refund);
        }

        if token_client.allowance(&payer, &contract) != 0 {
            panic_with_error!(&env, SettlementError::AllowanceNotConsumed);
        }

        enforce_balance_invariants(
            &env,
            &token_client,
            &payer,
            &pay_to,
            &contract,
            payer_before,
            payee_before,
            contract_before,
            actual,
        );

        if let Some(hook) = settlement_hook.clone() {
            let notice = SettlementNoticeV1 {
                actual,
                max_amount,
                pay_to: pay_to.clone(),
                payer: payer.clone(),
                settlement_id: settlement_id.clone(),
                token: token.clone(),
            };
            SettlementHookClient::new(&env, &hook).on_settled_v1(&notice, &contract);

            if token_client.allowance(&payer, &contract) != 0 {
                panic_with_error!(&env, SettlementError::AllowanceNotConsumed);
            }
            enforce_balance_invariants(
                &env,
                &token_client,
                &payer,
                &pay_to,
                &contract,
                payer_before,
                payee_before,
                contract_before,
                actual,
            );
        }

        Settled {
            payer,
            pay_to,
            token,
            facilitator,
            actual,
            maximum: max_amount,
            settlement_id,
            settlement_hook,
        }
        .publish(&env);

        Settlement {
            actual,
            maximum: max_amount,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn validate(
    env: &Env,
    payer: &Address,
    pay_to: &Address,
    token: &Address,
    max_amount: i128,
    valid_after: u32,
    deadline: u32,
    facilitator: &Address,
    settlement_hook: &Option<Address>,
    actual: i128,
) {
    if max_amount <= 0 {
        panic_with_error!(env, SettlementError::InvalidMaximum);
    }
    if actual < 0 {
        panic_with_error!(env, SettlementError::NegativeActual);
    }
    if actual > max_amount {
        panic_with_error!(env, SettlementError::ActualExceedsMaximum);
    }
    if valid_after > deadline {
        panic_with_error!(env, SettlementError::InvalidTimeWindow);
    }

    let current = env.ledger().sequence();
    if current < valid_after {
        panic_with_error!(env, SettlementError::NotYetValid);
    }
    if current > deadline {
        panic_with_error!(env, SettlementError::Expired);
    }

    let contract = env.current_contract_address();
    if payer == facilitator || payer == &contract {
        panic_with_error!(env, SettlementError::InvalidPayer);
    }
    if pay_to == &contract {
        panic_with_error!(env, SettlementError::InvalidRecipient);
    }
    if token == &contract {
        panic_with_error!(env, SettlementError::InvalidToken);
    }
    if settlement_hook
        .as_ref()
        .is_some_and(|hook| hook == &contract || hook == token)
    {
        panic_with_error!(env, SettlementError::InvalidSettlementHook);
    }
}

#[allow(clippy::too_many_arguments)]
fn enforce_balance_invariants(
    env: &Env,
    token: &token::TokenClient,
    payer: &Address,
    pay_to: &Address,
    contract: &Address,
    payer_before: i128,
    payee_before: i128,
    contract_before: i128,
    actual: i128,
) {
    if token.balance(contract) != contract_before {
        panic_with_error!(env, SettlementError::BalanceInvariantFailed);
    }

    if payer == pay_to {
        if token.balance(payer) != payer_before {
            panic_with_error!(env, SettlementError::BalanceInvariantFailed);
        }
        return;
    }

    let expected_payer = payer_before
        .checked_sub(actual)
        .unwrap_or_else(|| panic_with_error!(env, SettlementError::ArithmeticOverflow));
    let expected_payee = payee_before
        .checked_add(actual)
        .unwrap_or_else(|| panic_with_error!(env, SettlementError::ArithmeticOverflow));

    if token.balance(payer) != expected_payer || token.balance(pay_to) != expected_payee {
        panic_with_error!(env, SettlementError::BalanceInvariantFailed);
    }
}

#[cfg(test)]
mod test;
