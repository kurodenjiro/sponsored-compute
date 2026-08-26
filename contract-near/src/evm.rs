//! EIP-712 / EIP-3009 digest construction, done inside the contract.
//!
//! # Why this file exists at all
//!
//! The contract could accept a 32-byte hash and hand it to the MPC signer. That
//! would be a few lines instead of this file, and it would also hand the caller
//! an oracle that signs anything: a hash is opaque, so "pay the merchant 1 USDC"
//! and "move the whole balance to me" look identical going in. Everything this
//! project claims about purpose-bound spending dies at that door.
//!
//! So the contract takes the *fields*, checks them against its own state, and
//! builds the digest itself. Signing then cannot mean anything other than what
//! was checked. See docs/TASKS-NEAR.md §3, prohibition 4.
//!
//! # What is being built
//!
//! ```text
//! digest = keccak256(0x19 0x01 ‖ domainSeparator ‖ structHash)
//! ```
//!
//! Every field is ABI-encoded to exactly 32 bytes: integers big-endian,
//! addresses left-padded with 12 zero bytes, dynamic strings replaced by their
//! keccak hash. Getting any of that subtly wrong produces a signature that is
//! well-formed and simply does not verify — which is the expensive kind of bug,
//! so `tests/eip712.rs` checks the output byte-for-byte against vectors that
//! `viem` produced independently.

use near_sdk::env;

/// One ABI-encoded 32-byte slot.
pub type Word = [u8; 32];

const DOMAIN_TYPE: &[u8] =
    b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const TRANSFER_TYPE: &[u8] = b"TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

fn keccak(input: &[u8]) -> Word {
    let out = env::keccak256(input);
    let mut word = [0u8; 32];
    word.copy_from_slice(&out);
    word
}

/// Right-align a value in its slot, which is how ABI encoding treats every
/// fixed-size type — integers and addresses alike.
fn right_aligned(bytes: &[u8]) -> Word {
    let mut word = [0u8; 32];
    word[32 - bytes.len()..].copy_from_slice(bytes);
    word
}

pub fn word_from_u128(value: u128) -> Word {
    right_aligned(&value.to_be_bytes())
}

pub fn word_from_u64(value: u64) -> Word {
    right_aligned(&value.to_be_bytes())
}

pub fn word_from_address(address: &[u8; 20]) -> Word {
    right_aligned(address)
}

// ------------------------------------------------------------------- parsing

/// Parse `0x…` hex into a fixed-size array.
///
/// Strict on purpose: these values arrive from the agent, and a lenient parser
/// that quietly accepted a short address would produce a valid signature paying
/// somewhere nobody chose.
fn parse_hex<const N: usize>(input: &str, what: &str) -> [u8; N] {
    let body = input.strip_prefix("0x").unwrap_or_else(|| {
        env::panic_str(&format!("{what} must start with 0x"));
    });
    if body.len() != N * 2 {
        env::panic_str(&format!("{what} must be {N} bytes, got {} hex chars", body.len()));
    }
    let mut out = [0u8; N];
    let raw = body.as_bytes();
    for (i, slot) in out.iter_mut().enumerate() {
        let hi = hex_nibble(raw[i * 2], what);
        let lo = hex_nibble(raw[i * 2 + 1], what);
        *slot = (hi << 4) | lo;
    }
    out
}

fn hex_nibble(c: u8, what: &str) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => env::panic_str(&format!("{what} contains a non-hex character")),
    }
}

pub fn parse_address(input: &str) -> [u8; 20] {
    parse_hex::<20>(input, "address")
}

pub fn parse_word(input: &str) -> Word {
    parse_hex::<32>(input, "bytes32")
}

pub fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for b in bytes {
        out.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        out.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    out
}

// -------------------------------------------------------------------- digest

/// The EIP-712 domain of the token being spent.
///
/// `name` differs between networks for the same token — Circle's USDC is
/// `"USD Coin"` on Base mainnet and `"USDC"` on Base Sepolia — so it is carried
/// per-campaign rather than assumed.
pub struct Domain {
    pub name: String,
    pub version: String,
    pub chain_id: u64,
    pub verifying_contract: [u8; 20],
}

pub struct TransferAuthorization {
    pub from: [u8; 20],
    pub to: [u8; 20],
    pub value: Word,
    pub valid_after: Word,
    pub valid_before: Word,
    pub nonce: Word,
}

pub fn domain_separator(domain: &Domain) -> Word {
    let mut buf = Vec::with_capacity(32 * 5);
    buf.extend_from_slice(&keccak(DOMAIN_TYPE));
    buf.extend_from_slice(&keccak(domain.name.as_bytes()));
    buf.extend_from_slice(&keccak(domain.version.as_bytes()));
    buf.extend_from_slice(&word_from_u64(domain.chain_id));
    buf.extend_from_slice(&word_from_address(&domain.verifying_contract));
    keccak(&buf)
}

pub fn struct_hash(auth: &TransferAuthorization) -> Word {
    let mut buf = Vec::with_capacity(32 * 7);
    buf.extend_from_slice(&keccak(TRANSFER_TYPE));
    buf.extend_from_slice(&word_from_address(&auth.from));
    buf.extend_from_slice(&word_from_address(&auth.to));
    buf.extend_from_slice(&auth.value);
    buf.extend_from_slice(&auth.valid_after);
    buf.extend_from_slice(&auth.valid_before);
    buf.extend_from_slice(&auth.nonce);
    keccak(&buf)
}

/// The 32 bytes the MPC signer is asked to sign.
pub fn transfer_digest(domain: &Domain, auth: &TransferAuthorization) -> Word {
    let mut buf = Vec::with_capacity(2 + 64);
    buf.extend_from_slice(&[0x19, 0x01]);
    buf.extend_from_slice(&domain_separator(domain));
    buf.extend_from_slice(&struct_hash(auth));
    keccak(&buf)
}

// ============================================================================
// Signature assembly (task 1.3)
// ============================================================================

/// secp256k1 group order `n`, and `n/2`.
///
/// EIP-2 rejects signatures whose `s` sits in the upper half of the field,
/// because `(r, s)` and `(r, n-s)` both verify — an unnormalised signature is a
/// second valid encoding of the same authorisation, which is exactly the kind of
/// thing replay protection is supposed to make impossible.
const SECP256K1_N: Word = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];
const SECP256K1_HALF_N: Word = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

fn is_above_half_order(s: &Word) -> bool {
    for (a, b) in s.iter().zip(SECP256K1_HALF_N.iter()) {
        if a != b {
            return a > b;
        }
    }
    false
}

/// `n - s`, big-endian, no borrow out (guaranteed because `s < n`).
fn subtract_from_order(s: &Word) -> Word {
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let diff = i16::from(SECP256K1_N[i]) - i16::from(s[i]) - borrow;
        if diff < 0 {
            out[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            out[i] = diff as u8;
            borrow = 0;
        }
    }
    out
}

/// Turn the MPC's `(big_r, s, recovery_id)` into the 65-byte `r ‖ s ‖ v` that
/// `ecrecover` expects.
///
/// `big_r` arrives SEC1-compressed: one parity byte then the 32-byte x
/// coordinate, and `r` is that x coordinate. `v` is `recovery_id + 27` — the
/// offset is what distinguishes a signature over a transaction from one over
/// arbitrary data, and getting it wrong recovers a different address rather than
/// failing loudly.
pub fn assemble_signature(big_r_hex: &str, s_hex: &str, recovery_id: u8) -> String {
    let point = decode_hex(big_r_hex, "big_r");
    if point.len() != 33 {
        env::panic_str(&format!("big_r must be a 33-byte compressed point, got {}", point.len()));
    }
    let mut r = [0u8; 32];
    r.copy_from_slice(&point[1..]);

    let raw_s = decode_hex(s_hex, "s");
    if raw_s.len() != 32 {
        env::panic_str(&format!("s must be 32 bytes, got {}", raw_s.len()));
    }
    let mut s = [0u8; 32];
    s.copy_from_slice(&raw_s);

    let mut v = recovery_id;
    if is_above_half_order(&s) {
        s = subtract_from_order(&s);
        // Flipping s mirrors the point across the x-axis, which flips parity.
        v ^= 1;
    }

    let mut out = Vec::with_capacity(65);
    out.extend_from_slice(&r);
    out.extend_from_slice(&s);
    out.push(v + 27);
    to_hex(&out)
}

/// The MPC returns hex without an `0x` prefix; tolerate either.
fn decode_hex(input: &str, what: &str) -> Vec<u8> {
    let body = input.strip_prefix("0x").unwrap_or(input);
    if body.len() % 2 != 0 {
        env::panic_str(&format!("{what} has an odd number of hex characters"));
    }
    let raw = body.as_bytes();
    (0..body.len() / 2)
        .map(|i| (hex_nibble(raw[i * 2], what) << 4) | hex_nibble(raw[i * 2 + 1], what))
        .collect()
}

/// Parse and re-emit an address in lowercase, so stored allowlists and incoming
/// requests compare as plain strings instead of by checksum casing.
pub fn normalize_address(input: &str) -> String {
    to_hex(&parse_address(input))
}

// ============================================================================
// Contract methods for the Base leg (tasks 1.2, 1.4, 1.5)
// ============================================================================

use crate::{EvmLeg, GrantManager, GrantManagerExt, Reservation};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{ext_contract, near, require, Gas, NearToken, Promise, PromiseError};

/// secp256k1 — the curve Ethereum verifies with. `1` is ed25519.
const DOMAIN_SECP256K1: u32 = 0;
const SIGN_DEPOSIT: NearToken = NearToken::from_yoctonear(1);
const GAS_SIGN: Gas = Gas::from_tgas(60);
const GAS_ON_SIGNED: Gas = Gas::from_tgas(10);

/// How far ahead an authorisation may be valid.
///
/// Short on purpose: the window is how long the contract stays blind to an
/// outcome, and every live reservation is budget held hostage. It is also what
/// makes "expired" mean "settled or never will" rather than "still might".
const MAX_VALIDITY_NS: u64 = 300 * 1_000_000_000;

/// A grant may hold this many unsettled authorisations at once. Bounds both
/// storage and how much budget an agent can park by asking for signatures it
/// never submits.
const MAX_LIVE_RESERVATIONS: usize = 8;

#[near(serializers = [json])]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: Payload,
    pub domain_id: u32,
}

/// Matches the signer's externally-tagged enum: `{"Ecdsa":"<64 hex>"}`.
#[near(serializers = [json])]
pub enum Payload {
    Ecdsa(String),
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "scheme")]
pub enum SignatureResponse {
    Secp256k1 { big_r: AffinePoint, s: Scalar, recovery_id: u8 },
    Ed25519 { signature: Vec<u8> },
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct AffinePoint {
    pub affine_point: String,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Scalar {
    pub scalar: String,
}

#[allow(dead_code)]
#[ext_contract(ext_mpc)]
trait MpcSigner {
    fn sign(&mut self, request: SignRequest) -> SignatureResponse;
}

/// One Base address per campaign, so a sponsor funds one place.
pub fn campaign_path(campaign_id: &str) -> String {
    format!("campaign-{campaign_id}")
}

#[near]
impl GrantManager {
    // ------------------------------------------------------------- sponsor

    /// Point a campaign at a token on Base and at the address it signs from.
    #[payable]
    pub fn set_evm_leg(&mut self, id: String, leg: EvmLeg) {
        near_sdk::assert_one_yocto();
        require!(!leg.token_name.is_empty(), "token_name is the EIP-712 domain name and cannot be empty");
        let normalized = EvmLeg {
            chain_id: leg.chain_id,
            token: normalize_address(&leg.token),
            token_name: leg.token_name,
            token_version: leg.token_version,
            address: normalize_address(&leg.address),
        };
        self.campaign_of_sponsor(&id).evm = Some(normalized);
    }

    #[payable]
    pub fn set_evm_merchants(&mut self, id: String, merchants: Vec<String>) {
        near_sdk::assert_one_yocto();
        require!(merchants.len() <= crate::MAX_MERCHANTS, "too many merchants for one call");
        // Parsing here is the allowlist check later: a malformed entry can never
        // sit in state waiting to fail at signing time.
        let normalized = merchants.iter().map(|m| normalize_address(m)).collect();
        self.campaign_of_sponsor(&id).evm_merchants = normalized;
    }

    // ------------------------------------------------------------- spending

    /// Authorise one EIP-3009 transfer on Base.
    ///
    /// Takes **fields, never a digest**. The contract checks them against its own
    /// state and then builds what gets signed, so a signature cannot mean anything
    /// the caps did not allow (docs/TASKS-NEAR.md §3, prohibition 4).
    ///
    /// The amount is consumed the moment the signature is issued, not when it
    /// settles — the contract cannot see Base, and counting only confirmed
    /// settlements would let an agent collect authorisations without limit.
    pub fn request_evm_signature(
        &mut self,
        to: String,
        amount: U128,
        valid_before: U64,
        nonce: String,
    ) -> Promise {
        let grant_id = self.grant_id_of_signer();
        let now = env::block_timestamp();
        let to = normalize_address(&to);
        let nonce_word = parse_word(&nonce);

        let (campaign_id, leg) = {
            let g = self.grants.get(&grant_id).unwrap();
            let c = self.campaigns.get(&g.campaign_id).unwrap();
            let leg = c.evm.clone().unwrap_or_else(|| {
                env::panic_str("this campaign has no Base leg - the sponsor must call set_evm_leg")
            });
            require!(c.evm_merchants.contains(&to), "merchant not in the campaign allowlist");
            (g.campaign_id.clone(), leg)
        };

        require!(valid_before.0 > now, "valid_before is already in the past");
        require!(
            valid_before.0 <= now + MAX_VALIDITY_NS,
            "valid_before is further ahead than the contract will stay blind for"
        );

        self.drop_expired(grant_id, now);
        {
            let g = self.grants.get(&grant_id).unwrap();
            require!(
                g.reservations.len() < MAX_LIVE_RESERVATIONS,
                "too many unsettled authorisations - wait for them to expire or have the sponsor release them"
            );
            require!(
                !g.reservations.iter().any(|r| r.nonce == to_hex(&nonce_word)),
                "that nonce is already reserved"
            );
        }

        // Every cap, the same ones `pay_merchant` uses.
        self.consume(grant_id, amount.0);
        {
            let g = self.grants.get_mut(&grant_id).unwrap();
            g.reserved = U128(g.reserved.0 + amount.0);
            g.reservations.push(Reservation {
                nonce: to_hex(&nonce_word),
                to: to.clone(),
                amount,
                expires_ns: valid_before,
            });
        }

        let digest = transfer_digest(
            &Domain {
                name: leg.token_name.clone(),
                version: leg.token_version.clone(),
                chain_id: leg.chain_id,
                verifying_contract: parse_address(&leg.token),
            },
            &TransferAuthorization {
                from: parse_address(&leg.address),
                to: parse_address(&to),
                value: word_from_u128(amount.0),
                valid_after: word_from_u128(0),
                valid_before: word_from_u64(valid_before.0 / 1_000_000_000),
                nonce: nonce_word,
            },
        );

        ext_mpc::ext(self.mpc_signer.clone())
            .with_attached_deposit(SIGN_DEPOSIT)
            .with_static_gas(GAS_SIGN)
            .sign(SignRequest {
                path: campaign_path(&campaign_id),
                // The signer wants bare hex, no 0x.
                payload_v2: Payload::Ecdsa(to_hex(&digest)[2..].to_string()),
                domain_id: DOMAIN_SECP256K1,
            })
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SIGNED)
                    .on_signed(U64(grant_id), nonce),
            )
    }

    /// Hand back a ready-to-use 65-byte signature, or release the reservation.
    ///
    /// Assembling here rather than on the client means the caller cannot get the
    /// encoding wrong, and a failed signing round does not silently cost budget.
    #[private]
    pub fn on_signed(
        &mut self,
        grant_id: U64,
        nonce: String,
        #[callback_result] result: Result<SignatureResponse, PromiseError>,
    ) -> Option<String> {
        match result {
            Ok(SignatureResponse::Secp256k1 { big_r, s, recovery_id }) => {
                Some(assemble_signature(&big_r.affine_point, &s.scalar, recovery_id))
            }
            Ok(SignatureResponse::Ed25519 { .. }) => {
                env::panic_str("the signer returned an ed25519 signature for a secp256k1 request")
            }
            Err(_) => {
                // No signature was produced, so nothing can settle. Unlike an
                // expired reservation this outcome is certain, which is why it
                // releases without anyone having to attest to it.
                self.release(grant_id.0, &nonce);
                None
            }
        }
    }

    // ---------------------------------------------------------- reservations

    /// Give back the budget behind an authorisation that did not settle.
    ///
    /// 🔴 **Sponsor-only, and it has to be.** The plan originally had this
    /// permissionless, reasoning that an expired authorisation is dead on Base so
    /// releasing it cannot cause a double spend. That is true of any single
    /// signature and still wrong in aggregate: authorise, submit, let it expire,
    /// release, repeat — each one settles, none of them counts, and the campaign
    /// drains while the ledger reads zero. Only someone who can see Base knows
    /// which reservations really failed, and the sponsor is both that party and
    /// the one whose money is at stake.
    ///
    /// The safe default is therefore to do nothing: an unreleased reservation
    /// stays spent.
    #[payable]
    pub fn release_reservation(&mut self, grant_id: U64, nonce: String) -> U128 {
        near_sdk::assert_one_yocto();
        let g = self.grants.get(&grant_id.0).unwrap_or_else(|| env::panic_str("no grant"));
        let sponsor = self.campaigns.get(&g.campaign_id).unwrap().sponsor.clone();
        require!(env::predecessor_account_id() == sponsor, "only the sponsor releases a reservation");
        let nonce = to_hex(&parse_word(&nonce));
        require!(
            g.reservations.iter().any(|r| r.nonce == nonce),
            "no live reservation with that nonce"
        );
        U128(self.release(grant_id.0, &nonce))
    }

    /// Move a campaign's Base funds somewhere the sponsor controls.
    ///
    /// The counterpart to revocation: `DeleteKey` stops new signatures, and this
    /// retrieves what is left. It is an ordinary authorisation, so it passes
    /// through the same signing path — the difference is only that the sponsor
    /// names the destination.
    #[payable]
    pub fn sweep_evm(&mut self, id: String, to: String, amount: U128, valid_before: U64, nonce: String) -> Promise {
        near_sdk::assert_one_yocto();
        let now = env::block_timestamp();
        let leg = {
            let c = self.campaign_of_sponsor(&id);
            c.evm.clone().unwrap_or_else(|| env::panic_str("this campaign has no Base leg"))
        };
        require!(valid_before.0 > now && valid_before.0 <= now + MAX_VALIDITY_NS, "bad valid_before");

        let digest = transfer_digest(
            &Domain {
                name: leg.token_name.clone(),
                version: leg.token_version.clone(),
                chain_id: leg.chain_id,
                verifying_contract: parse_address(&leg.token),
            },
            &TransferAuthorization {
                from: parse_address(&leg.address),
                to: parse_address(&normalize_address(&to)),
                value: word_from_u128(amount.0),
                valid_after: word_from_u128(0),
                valid_before: word_from_u64(valid_before.0 / 1_000_000_000),
                nonce: parse_word(&nonce),
            },
        );

        ext_mpc::ext(self.mpc_signer.clone())
            .with_attached_deposit(SIGN_DEPOSIT)
            .with_static_gas(GAS_SIGN)
            .sign(SignRequest {
                path: campaign_path(&id),
                payload_v2: Payload::Ecdsa(to_hex(&digest)[2..].to_string()),
                domain_id: DOMAIN_SECP256K1,
            })
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_SIGNED).on_swept())
    }

    #[private]
    pub fn on_swept(&mut self, #[callback_result] result: Result<SignatureResponse, PromiseError>) -> Option<String> {
        match result {
            Ok(SignatureResponse::Secp256k1 { big_r, s, recovery_id }) => {
                Some(assemble_signature(&big_r.affine_point, &s.scalar, recovery_id))
            }
            _ => None,
        }
    }

    // ------------------------------------------------------------ internals

    /// Forget authorisations past their `validBefore`. They stay counted as
    /// spent — see `release_reservation` for why expiry alone is not evidence
    /// that nothing settled.
    fn drop_expired(&mut self, grant_id: u64, now: u64) {
        let g = self.grants.get_mut(&grant_id).unwrap();
        g.reservations.retain(|r| r.expires_ns.0 > now);
    }

    /// Undo one reservation's effect on every counter it touched.
    fn release(&mut self, grant_id: u64, nonce: &str) -> u128 {
        let g = self.grants.get_mut(&grant_id).unwrap();
        let Some(pos) = g.reservations.iter().position(|r| r.nonce == nonce) else {
            return 0;
        };
        let amount = g.reservations.remove(pos).amount.0;
        g.reserved = U128(g.reserved.0.saturating_sub(amount));
        g.spent = U128(g.spent.0.saturating_sub(amount));
        // `spent_today` may already have rolled over to a new day, in which case
        // it never carried this amount.
        g.spent_today = U128(g.spent_today.0.saturating_sub(amount));
        amount
    }
}
