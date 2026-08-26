//! A stand-in for `v1.signer` so the sandbox can exercise the callback path.
//!
//! It cannot produce a signature that recovers to the real derived address —
//! that needs the actual MPC key — so it answers with a fixed, well-formed
//! response instead. What that buys is everything around the signature: the
//! callback wiring, EIP-2 normalisation, the reservation lifecycle, and the
//! release-on-failure path.
//!
//! Its `s` is deliberately `n - 1`, above the curve's half order. A signer that
//! forgot to normalise would hand that straight back, so the assembled result
//! doubles as the check that normalisation happened.

use near_sdk::{env, near, PanicOnDefault};

/// Compressed point: parity byte then a 32-byte x coordinate.
const BIG_R: &str = "020000000000000000000000000000000000000000000000000000000000000042";
/// `n - 1` — normalising it must yield exactly 1.
const HIGH_S: &str = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140";

#[near(serializers = [json])]
pub struct AffinePoint {
    pub affine_point: String,
}

#[near(serializers = [json])]
pub struct Scalar {
    pub scalar: String,
}

#[near(serializers = [json])]
pub struct Secp256k1Response {
    pub scheme: String,
    pub big_r: AffinePoint,
    pub s: Scalar,
    pub recovery_id: u8,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockMpc {
    fail: bool,
}

#[near]
impl MockMpc {
    #[init]
    pub fn new() -> Self {
        Self { fail: false }
    }

    /// Make the next signing rounds fail, so the release-on-failure path is
    /// reachable without waiting for a real outage.
    pub fn set_fail(&mut self, fail: bool) {
        self.fail = fail;
    }

    #[payable]
    pub fn sign(&mut self, request: near_sdk::serde_json::Value) -> Secp256k1Response {
        near_sdk::assert_one_yocto();
        if self.fail {
            env::panic_str("mock signer: refusing on purpose");
        }
        // Echo enough of the request that a test can assert what was asked for.
        env::log_str(&request.to_string());
        Secp256k1Response {
            scheme: "Secp256k1".to_string(),
            big_r: AffinePoint { affine_point: BIG_R.to_string() },
            s: Scalar { scalar: HIGH_S.to_string() },
            recovery_id: 0,
        }
    }
}
