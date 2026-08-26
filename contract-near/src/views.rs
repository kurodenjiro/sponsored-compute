//! Read-only views on grant state.
//!
//! Nothing here mutates, attaches a deposit, or calls another contract, so it
//! carries none of the risk the ledger does. That is the reason it lives in its
//! own file: `lib.rs` stays small enough to read end to end, which is the
//! substitute this project has for an audit.
//!
//! The client must read policy from here rather than from a merchant's 402
//! challenge — the challenge is a claim, this is the contract's own state.

use crate::{Campaign, Grant, GrantManager, GrantManagerExt};
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, PublicKey};

#[near]
impl GrantManager {
    pub fn get_campaign(&self, id: String) -> Option<Campaign> {
        self.campaigns.get(&id).cloned()
    }

    pub fn get_grant(&self, grant_id: U64) -> Option<Grant> {
        self.grants.get(&grant_id.0).cloned()
    }

    /// What the MCP `get_grant_status` tool and the client checkpoint read.
    pub fn get_grant_by_repo(&self, campaign_id: String, repo: String) -> Option<Grant> {
        let id = self.grant_of_repo.get(&format!("{campaign_id}\n{repo}"))?;
        self.grants.get(id).cloned()
    }

    /// Look a grant up by the key that spends it.
    ///
    /// The agent holds that key and nothing else — making it name a campaign id
    /// and a repo just to find its own grant meant carrying config that the
    /// contract already knows, and that a poisoned `sponsored.json` could point
    /// somewhere else entirely.
    pub fn get_grant_by_key(&self, public_key: PublicKey) -> Option<Grant> {
        let id = self.grant_of_key.get(&public_key)?;
        self.grants.get(id).cloned()
    }

    /// Allowlist + caps as the *contract* sees them.
    pub fn get_policy(&self, grant_id: U64) -> Option<(Vec<AccountId>, U128, U128, AccountId)> {
        let g = self.grants.get(&grant_id.0)?;
        let c = self.campaigns.get(&g.campaign_id)?;
        Some((c.merchants.clone(), c.per_tx_cap, c.daily_cap, c.token_id.clone()))
    }
}
