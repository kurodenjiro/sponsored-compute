#!/usr/bin/env bash
# Two properties that no unit test can hold, because both are about what is
# ABSENT from the build.
#
#   guard 1 (task 0.5) — the wasm must import `panic_utf8`
#   guard 2 (task 1.10) — no EVM private key may exist anywhere
#
# Both fail silently in the worst way. A contract built without `--cfg near`
# still deploys and still enforces every rule; it just reports each refusal as
# "WebAssembly trap: unreachable" with the message gone. And a Base wallet added
# "just for testing" still pays merchants; it simply does it outside the reach of
# `DeleteKey`, which is the one property the whole architecture exists to give.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }

echo "▸ guard 1 — contract wasm talks to the NEAR runtime"
WASM=contract-near/target/wasm32-unknown-unknown/release/grant_manager.wasm
if [ ! -f "$WASM" ]; then
  bad "no wasm at $WASM — run: npm run near:build"
elif [ "$(strings "$WASM" | grep -c panic_utf8)" -gt 0 ]; then
  ok "imports panic_utf8 (built with --cfg near)"
else
  bad "no panic_utf8 import — built without --cfg near, every require! message is lost. Use: npm run near:build"
fi

echo "▸ guard 2 — no EVM key, anywhere"
SRC="src scripts merchant-demo mcp web/app web/lib contract-near/src"
SKIP="--exclude=ci-guards.sh"   # the guard names the very patterns it forbids
# The EOA helpers. Their presence means something signs locally instead of
# asking the contract.
if grep -rnE $SKIP "privateKeyToAccount|generatePrivateKey|mnemonicToAccount|hdKeyToAccount" $SRC 2>/dev/null; then
  bad "a local EVM signer is being constructed — Base signatures must come from grant-manager"
else
  ok "no local EVM signer is constructed"
fi
# Env vars that would carry one in.
if grep -rnE $SKIP "EVM_PRIVATE_KEY|BASE_PRIVATE_KEY|AGENT_PRIVATE_KEY|WALLET_SECRET" $SRC 2>/dev/null; then
  bad "an EVM private key is read from the environment"
else
  ok "no EVM private key is read from the environment"
fi
# Custodial wallet SDKs. Each one hands the agent a key on some other chain.
if grep -qE '"(@coinbase/cdp-sdk|@privy-io/[a-z-]+|@turnkey/[a-z-]+|awal)"' package.json; then
  bad "a custodial wallet SDK is a dependency — see docs/ROADMAP-NEAR-MVP.md §6.1"
else
  ok "no custodial wallet SDK is a dependency"
fi

[ $fail -eq 0 ] && echo "▸ guards passed" || echo "▸ guards FAILED"
exit $fail
