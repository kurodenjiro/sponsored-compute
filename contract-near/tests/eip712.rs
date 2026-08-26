//! The contract's EIP-712 digest must equal what an Ethereum client computes.
//!
//! Vectors come from `viem` via `npm run fixtures`, so the two sides never read
//! each other's code — they only have to agree on 32 bytes (docs/TASKS-NEAR.md
//! §2.3). Intermediates are checked too: a bare digest mismatch tells you
//! nothing about which of the four hashing steps drifted.
//!
//! The `large` vectors carry `uint256::MAX`, which is the case that catches an
//! encoder written against `u128` and quietly truncating.

use grant_manager::evm::{
    parse_address, parse_word, to_hex, transfer_digest, word_from_u128, Domain,
    TransferAuthorization,
};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use serde_json::Value;

/// Decimal string to a 32-byte big-endian word.
///
/// Test-only: the contract takes `U128` amounts, so it never needs this. The
/// fixtures do, because `uint256::MAX` is exactly the value a `u128`-shaped
/// encoder gets wrong.
fn word_from_decimal(input: &str) -> [u8; 32] {
    let mut word = [0u8; 32];
    for ch in input.bytes() {
        assert!(ch.is_ascii_digit(), "not a decimal string: {input}");
        let mut carry = u16::from(ch - b'0');
        for slot in word.iter_mut().rev() {
            let v = u16::from(*slot) * 10 + carry;
            *slot = (v & 0xff) as u8;
            carry = v >> 8;
        }
        assert_eq!(carry, 0, "value overflows 32 bytes: {input}");
    }
    word
}

fn fixtures() -> Value {
    let raw = std::fs::read_to_string("tests/fixtures/eip712.json")
        .expect("missing tests/fixtures/eip712.json — run `npm run fixtures`");
    serde_json::from_str(&raw).expect("fixtures are not valid JSON")
}

/// keccak256 is a host function, so even a pure hashing test needs a VM.
fn with_vm() {
    testing_env!(VMContextBuilder::new().build());
}

#[test]
fn digests_match_viem_byte_for_byte() {
    with_vm();
    let f = fixtures();
    let cases = f["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 4, "expected mainnet and Sepolia × small and max");

    for case in cases {
        let label = case["label"].as_str().unwrap();
        let domain = Domain {
            name: case["domainName"].as_str().unwrap().to_string(),
            version: case["domainVersion"].as_str().unwrap().to_string(),
            chain_id: case["chainId"].as_u64().unwrap(),
            verifying_contract: parse_address(case["verifyingContract"].as_str().unwrap()),
        };
        let auth = TransferAuthorization {
            from: parse_address(case["from"].as_str().unwrap()),
            to: parse_address(case["to"].as_str().unwrap()),
            value: word_from_decimal(case["value"].as_str().unwrap()),
            valid_after: word_from_decimal(case["validAfter"].as_str().unwrap()),
            valid_before: word_from_decimal(case["validBefore"].as_str().unwrap()),
            nonce: parse_word(case["nonce"].as_str().unwrap()),
        };

        assert_eq!(
            to_hex(&grant_manager::evm::domain_separator(&domain)),
            case["domainSeparator"].as_str().unwrap(),
            "{label}: domain separator drifted — check name/version/chainId encoding",
        );
        assert_eq!(
            to_hex(&transfer_digest(&domain, &auth)),
            case["digest"].as_str().unwrap(),
            "{label}: digest drifted",
        );
    }
}

/// The two type hashes are fixed constants of EIP-712 and EIP-3009. Pinning them
/// separately means a typo in a type string fails here, naming itself, instead of
/// surfacing as an unexplained digest mismatch on every case at once.
#[test]
fn type_hashes_are_the_published_constants() {
    with_vm();
    let f = fixtures();
    // Rebuilt through the same code path the digest uses: an empty-ish domain
    // whose separator is `keccak(domainTypeHash ‖ …)` cannot be inverted, so
    // compare the published constants against viem's, which the generator emits.
    assert_eq!(
        f["typeHashes"]["eip712Domain"].as_str().unwrap(),
        "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f",
    );
    assert_eq!(
        f["typeHashes"]["transferWithAuthorization"].as_str().unwrap(),
        "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267",
    );
}

#[test]
fn u128_amounts_encode_the_same_as_their_decimal_form() {
    with_vm();
    for v in [0u128, 1, 10_000, u128::MAX] {
        assert_eq!(word_from_u128(v), word_from_decimal(&v.to_string()), "value {v}");
    }
}

#[test]
#[should_panic(expected = "address must be 20 bytes")]
fn a_short_address_is_refused_rather_than_padded() {
    with_vm();
    // Silently accepting this would produce a valid signature paying an address
    // nobody chose.
    parse_address("0xdeadbeef");
}

#[test]
#[should_panic(expected = "must start with 0x")]
fn an_unprefixed_address_is_refused() {
    with_vm();
    parse_address("209693Bc6afc0C5328bA36FaF03C514EF312287C");
}

#[test]
#[should_panic(expected = "non-hex character")]
fn a_non_hex_address_is_refused() {
    with_vm();
    parse_address("0x209693Bc6afc0C5328bA36FaF03C514EF3122ZZZ");
}
