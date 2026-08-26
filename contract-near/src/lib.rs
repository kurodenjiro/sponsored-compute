//! grant-manager.near — purpose-bound infrastructure credit for AI agents.
//!
//! Port of `contracts/src/GrantManager.sol` (Avalanche/XSGD). The Solidity
//! version had to *implement* purpose-binding; on NEAR most of it is a protocol
//! primitive, so this contract only has to keep the ledger.
//!
//! ## Where the access key lives — read before changing `claim_grant`
//! The key goes on **this contract**, not on the agent's account: NEAR only
//! permits `AddKey`/`DeleteKey` when `predecessor == receiver`. The agent signs
//! with `signer_id = grant-manager`, so identity comes from
//! `env::signer_account_pk()`, never from `predecessor_account_id()`. Full
//! reasoning and what it buys: contract-near/README.md.
//!
//! ⚠️ `allowance` is a **gas** budget in yoctoNEAR, not a spend cap — those live
//! in `Campaign`/`Grant`. Key = *who may call what*; state = *how much*.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Allowance, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue, PublicKey,
};

/// Read-only methods. Split out so the part that can move money stays small
/// enough to review in one sitting — the whole security argument rests on that
/// (docs/ROADMAP-NEAR-MVP.md §7, criterion 6).
mod views;

/// EIP-712 digest construction for the Base leg. Reviewed separately from the
/// ledger (docs/ROADMAP-NEAR-MVP.md §7, criterion 6).
pub mod evm;

const DAY_NS: u64 = 86_400_000_000_000;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_STORAGE_CHECK: Gas = Gas::from_tgas(5);
/// Each merchant costs one view call; bound the list so gas stays predictable.
const MAX_MERCHANTS: usize = 10;
/// The only methods a grant key may call — the runtime rejects anything else.
///
/// Adding one here widens what every existing grant can do, so the list is the
/// security boundary, not a convenience. Each entry is a method that spends
/// against the grant's own caps and nothing else.
const GRANT_METHODS: &str = "pay_merchant,claim_tranche,request_evm_signature";

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Campaigns,
    Grants,
    GrantOfRepo,
    GrantOfKey,
}

/// Sponsor-set terms. Immutable once created except `paused` and `merchants`.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Campaign {
    pub sponsor: AccountId,
    /// NEP-141 token the campaign pays in (e.g. USDC). One token per campaign.
    pub token_id: AccountId,
    /// Merchant allowlist — sponsor-curated in v1 (§7.2 layer 5). The source of
    /// truth for `pay_merchant`; a merchant's own 402 challenge is never trusted.
    pub merchants: Vec<AccountId>,
    /// The Base leg. `None` until a sponsor funds an EVM address for this campaign.
    pub evm: Option<EvmLeg>,
    /// Base merchants, lowercase `0x…`.
    ///
    /// Separate from `merchants` because `AccountId` cannot carry an EVM address
    /// with any meaning: lowercase hex happens to pass NEAR's validity rules, so
    /// one shared list would *accept* a Base address and then explode the first
    /// time something handed it to `ft_transfer`.
    pub evm_merchants: Vec<String>,
    pub funded: U128,
    pub committed: U128,
    pub grant_amount: U128,
    /// §7.2 layer 4 — release in tranches, not one lump. Sybil payoff per repo
    /// is one tranche, not the whole grant.
    pub tranche_count: u32,
    pub tranche_period_ns: U64,
    pub min_spend_per_tranche: U128,
    pub grant_validity_ns: U64,
    pub per_tx_cap: U128,
    pub daily_cap: U128,
    /// yoctoNEAR of gas allowance put on each issued access key.
    ///
    /// 🔴 This is a **prepaid-gas** budget and the runtime checks it per
    /// transaction, before anything runs. Set it below the cost of a single call
    /// and the grant is dead on arrival: every payment fails with
    /// `NotEnoughAllowance` while the token budget sits untouched, and nothing
    /// this contract says explains why. Size it as
    /// `prepaid gas per call × expected calls`, and note that over-attaching gas
    /// on the client does not merely waste gas — it drains the key.
    /// Pinned by `an_allowance_below_one_call_bricks_the_grant` in tests/sandbox.rs.
    pub key_allowance: U128,
    pub paused: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Grant {
    pub id: U64,
    pub campaign_id: String,
    /// Repo the grant is bound to (§7.2 layer 1). One repo, one grant, forever.
    pub repo: String,
    pub owner: AccountId,
    pub agent_pk: PublicKey,
    pub total: U128,
    pub released: U128,
    pub spent: U128,
    pub spent_today: U128,
    pub day: U64,
    pub spent_at_tranche: U128,
    pub tranche_claimed: u32,
    /// Part of `spent` that was authorised for Base but never confirmed to have
    /// settled. Counted against every cap from the moment the signature is
    /// issued — see `request_evm_signature`.
    pub reserved: U128,
    pub reservations: Vec<Reservation>,
    pub issued_at_ns: U64,
    pub expiry_ns: U64,
    pub revoked: bool,
}

/// What NEP-141 `storage_balance_of` returns; `None` means "not registered".
#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

/// EIP-712 domain of the token a campaign pays in on Base, plus the address the
/// contract signs from.
///
/// Held in contract state rather than taken per call: the digest has to be built
/// from something the caller cannot choose, or "sign this payment" and "sign
/// anything" become the same request.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct EvmLeg {
    pub chain_id: u64,
    /// ERC-20 contract, lowercase `0x…`.
    pub token: String,
    /// EIP-712 `name`. Circle's USDC is `"USD Coin"` on Base and `"USDC"` on
    /// Base Sepolia — the same token, a different domain.
    pub token_name: String,
    pub token_version: String,
    /// The address this campaign signs from: `derived(grant-manager, "campaign-<id>")`.
    ///
    /// Supplied by the sponsor, who is also the one funding it. A wrong value
    /// costs them working payments, never anyone else's money — the signature
    /// simply will not recover to an address that holds anything.
    pub address: String,
}

/// A signature the contract issued whose fate on Base it cannot observe.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Reservation {
    pub nonce: String,
    pub to: String,
    pub amount: U128,
    /// The `validBefore` the contract signed. Past this the authorisation is
    /// dead on Base, so the outcome is final either way.
    pub expires_ns: U64,
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance>;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GrantManager {
    pub(crate) campaigns: IterableMap<String, Campaign>,
    pub(crate) grants: IterableMap<u64, Grant>,
    /// `campaign_id\nrepo` → grant id. Forking a sponsored repo does not clone money.
    pub(crate) grant_of_repo: LookupMap<String, u64>,
    pub(crate) grant_of_key: LookupMap<PublicKey, u64>,
    pub(crate) next_grant_id: u64,
    /// The MPC signer this deployment asks for Base signatures.
    ///
    /// State rather than a constant picked from the account suffix: that guess
    /// is wrong on any account whose name does not encode its network, and it
    /// leaves no way to point a test at a stand-in.
    pub(crate) mpc_signer: AccountId,
}

#[near]
impl GrantManager {
    #[init]
    pub fn new(mpc_signer: AccountId) -> Self {
        Self {
            mpc_signer,
            campaigns: IterableMap::new(Key::Campaigns),
            grants: IterableMap::new(Key::Grants),
            grant_of_repo: LookupMap::new(Key::GrantOfRepo),
            grant_of_key: LookupMap::new(Key::GrantOfKey),
            next_grant_id: 1,
        }
    }

    // ------------------------------------------------------------- sponsor

    pub fn create_campaign(&mut self, id: String, campaign: Campaign) {
        require!(!self.campaigns.contains_key(&id), "campaign exists");
        require!(campaign.tranche_count > 0, "tranche_count=0");
        require!(campaign.grant_amount.0 > 0, "grant_amount=0");
        require!(campaign.per_tx_cap.0 > 0, "per_tx_cap=0");
        let mut c = campaign;
        // Funding counters are ledger state, never caller input.
        c.sponsor = env::predecessor_account_id();
        c.funded = U128(0);
        c.committed = U128(0);
        c.paused = false;
        // The Base leg arrives through `set_evm_leg`/`set_evm_merchants`, which
        // validate. Accepting it here would mean parsing addresses in two places.
        c.evm = None;
        c.evm_merchants = Vec::new();
        self.campaigns.insert(id, c);
    }

    /// NEP-141 funding hook. `msg` is the campaign id — §4.4: fund and account
    /// for it in one atomic transaction, no separate approve/transferFrom dance.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let c = self.campaigns.get_mut(&msg).unwrap_or_else(|| env::panic_str("no campaign"));
        require!(token == c.token_id, "wrong token for this campaign");
        require!(sender_id == c.sponsor, "only the sponsor funds a campaign");
        c.funded = U128(c.funded.0 + amount.0);
        // Everything accepted; nothing to refund.
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn set_paused(&mut self, id: String, paused: bool) {
        near_sdk::assert_one_yocto();
        self.campaign_of_sponsor(&id).paused = paused;
    }

    /// Approve the merchants a campaign may pay.
    ///
    /// Every one is checked against the token's storage registry first. NEP-141
    /// refuses to credit an unregistered account, so an unchecked allowlist
    /// produces a payment that passes every policy check, consumes the grant's
    /// budget, and then fails inside `ft_transfer` — the callback puts the budget
    /// back, but the developer's agent just watched a correct request do nothing.
    /// Failing here instead names the account while the sponsor is still looking.
    #[payable]
    pub fn set_merchants(&mut self, id: String, merchants: Vec<AccountId>) -> Promise {
        near_sdk::assert_one_yocto();
        require!(merchants.len() <= MAX_MERCHANTS, "too many merchants for one call");
        let token = self.campaign_of_sponsor(&id).token_id.clone();

        let mut checks = merchants.iter().map(|m| {
            ext_ft::ext(token.clone())
                .with_static_gas(GAS_STORAGE_CHECK)
                .storage_balance_of(m.clone())
        });
        let joined = match checks.next() {
            Some(first) => checks.fold(first, |acc, next| acc.and(next)),
            // An empty list needs no checking: it revokes every merchant.
            None => return Self::ext(env::current_account_id()).on_merchants_checked(id, merchants),
        };
        joined.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FT_TRANSFER)
                .on_merchants_checked(id, merchants),
        )
    }

    #[private]
    pub fn on_merchants_checked(
        &mut self,
        id: String,
        merchants: Vec<AccountId>,
        #[callback_vec] balances: Vec<Option<StorageBalance>>,
    ) {
        for (m, balance) in merchants.iter().zip(balances.iter()) {
            require!(
                balance.is_some(),
                format!("{m} is not registered for storage on the campaign token - call storage_deposit for it first")
            );
        }
        self.campaigns.get_mut(&id).unwrap_or_else(|| env::panic_str("no campaign")).merchants = merchants;
    }

    /// Withdraw what is not committed to a grant. Committed funds stay locked
    /// until the grant is revoked or expires.
    #[payable]
    pub fn withdraw_unused(&mut self, id: String) -> Promise {
        near_sdk::assert_one_yocto();
        let c = self.campaign_of_sponsor(&id);
        let free = c.funded.0 - c.committed.0;
        require!(free > 0, "nothing free");
        c.funded = U128(c.funded.0 - free);
        let (token, sponsor) = (c.token_id.clone(), c.sponsor.clone());
        ext_ft::ext(token)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(sponsor, U128(free), Some("withdraw_unused".into()))
    }

    // --------------------------------------------------------------- claim

    /// Issue the grant for `repo` and hand the agent a purpose-bound access key.
    ///
    /// `agent_pk` is the agent's own public key; the secret half never leaves the
    /// developer's machine and never enters the model's context.
    pub fn claim_grant(&mut self, campaign_id: String, repo: String, agent_pk: PublicKey) -> U64 {
        let c = self
            .campaigns
            .get(&campaign_id)
            .unwrap_or_else(|| env::panic_str("no campaign"))
            .clone();
        require!(!c.paused, "campaign paused");
        let repo_key = format!("{campaign_id}\n{repo}");
        require!(!self.grant_of_repo.contains_key(&repo_key), "repo already granted");
        require!(!self.grant_of_key.contains_key(&agent_pk), "key already bound to a grant");
        require!(c.funded.0 - c.committed.0 >= c.grant_amount.0, "campaign out of funds");

        let now = env::block_timestamp();
        let id = self.next_grant_id;
        self.next_grant_id += 1;
        let grant = Grant {
            id: U64(id),
            campaign_id: campaign_id.clone(),
            repo,
            owner: env::predecessor_account_id(),
            agent_pk: agent_pk.clone(),
            total: c.grant_amount,
            // First tranche only — the rest vests against real usage.
            released: U128(c.grant_amount.0 / c.tranche_count as u128),
            spent: U128(0),
            spent_today: U128(0),
            day: U64(now / DAY_NS),
            spent_at_tranche: U128(0),
            tranche_claimed: 1,
            reserved: U128(0),
            reservations: Vec::new(),
            issued_at_ns: U64(now),
            expiry_ns: U64(now + c.grant_validity_ns.0),
            revoked: false,
        };
        self.grants.insert(id, grant);
        self.grant_of_repo.insert(repo_key, id);
        self.grant_of_key.insert(agent_pk.clone(), id);
        self.campaigns.get_mut(&campaign_id).unwrap().committed =
            U128(c.committed.0 + c.grant_amount.0);

        Promise::new(env::current_account_id()).add_access_key_allowance(
            agent_pk,
            Allowance::limited(NearToken::from_yoctonear(c.key_allowance.0))
                .unwrap_or_else(|| env::panic_str("key_allowance=0")),
            env::current_account_id(),
            GRANT_METHODS.to_string(),
        )
        .detach();
        U64(id)
    }

    // ------------------------------------------------------------- spending

    /// The on-chain half of the checkpoint. `src/checkpoint.ts` refuses the same
    /// requests earlier and for free; this one nobody can patch out.
    pub fn pay_merchant(&mut self, to: AccountId, amount: U128, memo: Option<String>) -> Promise {
        let id = self.grant_id_of_signer();
        let (token, gid) = {
            let g = self.grants.get(&id).unwrap().clone();
            let c = self.campaigns.get(&g.campaign_id).unwrap().clone();
            require!(c.merchants.contains(&to), "merchant not in the campaign allowlist");
            self.consume(id, amount.0);
            (c.token_id, g.id)
        };
        ext_ft::ext(token)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to, amount, memo)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FT_TRANSFER)
                    .on_paid(gid, amount),
            )
    }

    /// Settlement failed → put the budget back. Without this a failed transfer
    /// would burn the developer's cap for a payment the merchant never received.
    #[private]
    pub fn on_paid(
        &mut self,
        grant_id: U64,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        let g = self.grants.get_mut(&grant_id.0).unwrap();
        g.spent = U128(g.spent.0 - amount.0);
        g.spent_today = U128(g.spent_today.0.saturating_sub(amount.0));
        // `committed` stays put: the money is still reserved for this grant.
        false
    }

    /// Release the next tranche. Every condition is verified from on-chain state
    /// — no oracle, no sponsor signature, nothing to bribe.
    pub fn claim_tranche(&mut self) -> U128 {
        let id = self.grant_id_of_signer();
        let g = self.grants.get(&id).unwrap().clone();
        let c = self.campaigns.get(&g.campaign_id).unwrap().clone();
        require!(!g.revoked, "grant revoked");
        require!(g.tranche_claimed < c.tranche_count, "all tranches claimed");
        require!(
            env::block_timestamp() >= g.issued_at_ns.0 + g.tranche_claimed as u64 * c.tranche_period_ns.0,
            "tranche not ready"
        );
        require!(
            g.spent.0 - g.spent_at_tranche.0 >= c.min_spend_per_tranche.0,
            "not enough real usage for the next tranche"
        );
        let g = self.grants.get_mut(&id).unwrap();
        g.spent_at_tranche = g.spent;
        g.tranche_claimed += 1;
        g.released = U128(g.released.0 + g.total.0 / c.tranche_count as u128);
        g.released
    }

    // -------------------------------------------------------------- revoke

    /// Kill switch. Deleting the key stops NEAR spending *and* — once the
    /// Chain Signatures leg lands — every derived chain at the same instant,
    /// because signing runs through this contract too.
    #[payable]
    pub fn revoke_grant(&mut self, grant_id: U64) -> Promise {
        near_sdk::assert_one_yocto();
        let g = self.grants.get(&grant_id.0).unwrap_or_else(|| env::panic_str("no grant")).clone();
        require!(!g.revoked, "already revoked");
        require!(
            env::predecessor_account_id() == self.campaigns.get(&g.campaign_id).unwrap().sponsor,
            "only the sponsor revokes"
        );
        self.grants.get_mut(&grant_id.0).unwrap().revoked = true;
        self.grant_of_key.remove(&g.agent_pk);
        let unspent = g.total.0 - g.spent.0;
        let c = self.campaigns.get_mut(&g.campaign_id).unwrap();
        c.committed = U128(c.committed.0 - unspent);
        Promise::new(env::current_account_id()).delete_key(g.agent_pk)
    }

    // ------------------------------------------------------------ internals

    fn campaign_of_sponsor(&mut self, id: &String) -> &mut Campaign {
        let c = self.campaigns.get_mut(id).unwrap_or_else(|| env::panic_str("no campaign"));
        require!(env::predecessor_account_id() == c.sponsor, "not the sponsor");
        c
    }

    /// A grant is identified by the key that signed, not by the caller: on the
    /// access-key path `predecessor_account_id()` is always this contract.
    fn grant_id_of_signer(&self) -> u64 {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "call this with the grant's function-call access key"
        );
        *self
            .grant_of_key
            .get(&env::signer_account_pk())
            .unwrap_or_else(|| env::panic_str("this key has no grant"))
    }

    fn consume(&mut self, id: u64, amount: u128) {
        let c = {
            let g = self.grants.get(&id).unwrap();
            self.campaigns.get(&g.campaign_id).unwrap().clone()
        };
        let now = env::block_timestamp();
        let g = self.grants.get_mut(&id).unwrap();
        require!(amount > 0, "amount=0");
        require!(!g.revoked, "grant revoked");
        require!(now < g.expiry_ns.0, "grant expired");
        require!(!c.paused, "campaign paused");
        require!(amount <= c.per_tx_cap.0, "over the per-transaction cap");
        let today = now / DAY_NS;
        if today != g.day.0 {
            g.day = U64(today);
            g.spent_today = U128(0);
        }
        require!(g.spent_today.0 + amount <= c.daily_cap.0, "over the daily cap");
        require!(g.spent.0 + amount <= g.released.0, "beyond the vested amount — wait for the next tranche");
        g.spent_today = U128(g.spent_today.0 + amount);
        g.spent = U128(g.spent.0 + amount);
    }
}
