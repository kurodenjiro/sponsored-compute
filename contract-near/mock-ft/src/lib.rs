//! The smallest NEP-141 that can fail the way a real one fails.
//!
//! Only exists so `contract-near/tests/sandbox.rs` can exercise the cross-contract
//! half of `pay_merchant`, which the mocked-VM tests cannot reach. It is not a
//! faithful token: no fees, no metadata beyond decimals, `mint` is open to
//! anyone. What it does reproduce exactly is the one behaviour the grant ledger
//! depends on — **`ft_transfer` panics when the receiver is not registered for
//! storage** — because that is the path where a payment passes every policy check
//! and still moves nothing.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

/// NEP-141's registration fee. Real tokens refund the excess; this one keeps it.
const STORAGE_COST: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Balances,
    Registered,
}

#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    balances: LookupMap<AccountId, u128>,
    registered: LookupMap<AccountId, bool>,
    decimals: u8,
}

#[near]
impl MockFt {
    #[init]
    pub fn new(decimals: u8) -> Self {
        Self {
            balances: LookupMap::new(Key::Balances),
            registered: LookupMap::new(Key::Registered),
            decimals,
        }
    }

    // ------------------------------------------------------------- storage

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = registration_only;
        require!(env::attached_deposit() >= STORAGE_COST, "not enough deposit to register");
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        self.registered.insert(who, true);
        StorageBalance { total: U128(STORAGE_COST.as_yoctonear()), available: U128(0) }
    }

    /// Present so a test can take a merchant off the token *after* the sponsor
    /// allowlisted it — the realistic way a transfer starts failing later.
    pub fn storage_unregister(&mut self, account_id: AccountId) -> bool {
        self.registered.insert(account_id.clone(), false);
        self.balances.insert(account_id, 0);
        true
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        match self.registered.get(&account_id) {
            Some(true) => Some(StorageBalance { total: U128(STORAGE_COST.as_yoctonear()), available: U128(0) }),
            _ => None,
        }
    }

    // --------------------------------------------------------------- token

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(self.is_registered(&account_id), "receiver is not registered");
        let now = self.balances.get(&account_id).copied().unwrap_or(0);
        self.balances.insert(account_id, now + amount.0);
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({ "spec": "ft-1.0.0", "name": "Mock", "symbol": "MOCK", "decimals": self.decimals })
    }

    /// The behaviour under test: an unregistered receiver makes this panic, which
    /// is what drives `grant-manager`'s rollback callback.
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let _ = memo;
        require!(self.is_registered(&receiver_id), "receiver is not registered for storage");
        self.debit(&env::predecessor_account_id(), amount.0);
        let now = self.balances.get(&receiver_id).copied().unwrap_or(0);
        self.balances.insert(receiver_id, now + amount.0);
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> Promise {
        near_sdk::assert_one_yocto();
        let _ = memo;
        require!(self.is_registered(&receiver_id), "receiver is not registered for storage");
        let sender = env::predecessor_account_id();
        self.debit(&sender, amount.0);
        let now = self.balances.get(&receiver_id).copied().unwrap_or(0);
        self.balances.insert(receiver_id.clone(), now + amount.0);
        // Fire-and-forget: this mock never refunds, so nothing reads the result.
        Promise::new(receiver_id).function_call(
            "ft_on_transfer".to_string(),
            near_sdk::serde_json::json!({ "sender_id": sender, "amount": amount, "msg": msg })
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(0),
            near_sdk::Gas::from_tgas(30),
        )
    }

    fn is_registered(&self, who: &AccountId) -> bool {
        matches!(self.registered.get(who), Some(true))
    }

    fn debit(&mut self, who: &AccountId, amount: u128) {
        let now = self.balances.get(who).copied().unwrap_or(0);
        require!(now >= amount, "not enough balance");
        self.balances.insert(who.clone(), now - amount);
    }
}
