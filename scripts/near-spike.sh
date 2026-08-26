#!/usr/bin/env bash
# Week-0 spike, run end to end against a live NEAR testnet deployment.
#
# It answers the four questions the gate in docs/PROPOSAL-NEAR.md §10 asks, with
# real transactions rather than reasoning:
#   1. does ft_transfer_call fund a campaign atomically, storage_deposit included?
#   2. does a FunctionCall access key actually confine the agent to two methods?
#   3. do the caps hold at BOTH layers — client checkpoint and contract?
#   4. does DeleteKey stop spending instantly?
#
# Sponsor and developer steps go through `near`, so their full-access keys stay
# in the OS keychain. Only the agent's own key is handled by our code.
set -euo pipefail
cd "$(dirname "$0")/.."

NET=testnet
GM=${NEAR_GRANT_MANAGER:-gm.anyone3-pay.testnet}
TOKEN=usdc.fakes.testnet
SPONSOR=anyone3-pay.testnet
DEV=agenttest1.testnet
MERCHANT=anyone-pay.testnet
EVIL=agenttest1.testnet          # a real account that is NOT on the allowlist
CAMPAIGN=${CAMPAIGN:-spike}
REPO=${REPO:-github.com/kurodenjiro/x402-hack}

USDC=1000000                     # 6 decimals

say() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  %s\033[0m\n' "$*"; }

call() { # call <contract> <method> <json> <deposit> <signer>
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas '100.0 Tgas' attached-deposit "$4" \
    sign-as "$5" network-config "$NET" sign-with-keychain send 2>&1 | grep -E 'succeeded|Error|panicked|Transaction ID' || true
}

view() { # view <contract> <method> <json>
  near contract call-function as-read-only "$1" "$2" json-args "$3" \
    network-config "$NET" now 2>&1 | sed -n '/return value/,/^$/p' | tail -n +2
}

AGENT_PK=$(npx tsx scripts/near-agent.ts pubkey)
say "agent public key: $AGENT_PK"

say "1/9  create campaign '$CAMPAIGN'"
call "$GM" create_campaign "$(cat <<JSON
{"id":"$CAMPAIGN","campaign":{
  "sponsor":"$SPONSOR","token_id":"$TOKEN","merchants":["$MERCHANT"],
  "funded":"0","committed":"0",
  "grant_amount":"$((50*USDC))","tranche_count":10,
  "tranche_period_ns":"86400000000000","min_spend_per_tranche":"$((2*USDC))",
  "grant_validity_ns":"2592000000000000",
  "per_tx_cap":"$((2*USDC))","daily_cap":"$((4*USDC))",
  "key_allowance":"1000000000000000000000000","paused":false}}
JSON
)" '0 NEAR' "$SPONSOR"

say "2/9  fund it with 200 USDC via ft_transfer_call (one atomic transaction)"
call "$TOKEN" ft_transfer_call \
  "{\"receiver_id\":\"$GM\",\"amount\":\"$((200*USDC))\",\"msg\":\"$CAMPAIGN\"}" \
  '1 yoctoNEAR' "$SPONSOR"
echo "  campaign funded: $(view "$GM" get_campaign "{\"id\":\"$CAMPAIGN\"}" | grep -E '"(funded|committed)"' | tr -d ' \n')"

say "3/9  developer claims the grant — contract issues the access key"
call "$GM" claim_grant \
  "{\"campaign_id\":\"$CAMPAIGN\",\"repo\":\"$REPO\",\"agent_pk\":\"$AGENT_PK\"}" \
  '0 NEAR' "$DEV"

say "4/9  the key the contract just handed out"
near account list-keys "$GM" network-config "$NET" now 2>&1 | grep -A3 "${AGENT_PK#ed25519:}" || true

say "5/9  grant state as the agent reads it"
npx tsx scripts/near-agent.ts status "$CAMPAIGN" "$REPO"

say "6/9  a real payment: 1 USDC to the allowlisted merchant"
before=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$MERCHANT\"}")
npx tsx scripts/near-agent.ts pay "$CAMPAIGN" "$REPO" "$MERCHANT" "$USDC" "$((2*USDC))"
after=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$MERCHANT\"}")
echo "  merchant USDC: $before → $after"

say "7/9  layer 1 — the client checkpoint refuses, off-chain and free"
npx tsx scripts/near-agent.ts pay "$CAMPAIGN" "$REPO" "$EVIL"     "$USDC"     "$((2*USDC))" || warn "denied (expected)"
npx tsx scripts/near-agent.ts pay "$CAMPAIGN" "$REPO" "$MERCHANT" "$((3*USDC))" "$((5*USDC))" || warn "denied (expected)"

say "8/9  layer 2 — skip the checkpoint entirely; the contract still refuses"
npx tsx scripts/near-agent.ts pay-unchecked "$EVIL"     "$USDC"     || warn "contract rejected it (expected)"
npx tsx scripts/near-agent.ts pay-unchecked "$MERCHANT" "$((3*USDC))" || warn "contract rejected it (expected)"

say "9/9  sponsor revokes — one call deletes the key"
GRANT_ID=$(view "$GM" get_grant_by_repo "{\"campaign_id\":\"$CAMPAIGN\",\"repo\":\"$REPO\"}" | grep -o '"id": "[0-9]*"' | grep -o '[0-9]*')
echo "  revoking grant #$GRANT_ID"
call "$GM" revoke_grant "{\"grant_id\":\"$GRANT_ID\"}" '1 yoctoNEAR' "$SPONSOR"
npx tsx scripts/near-agent.ts pay-unchecked "$MERCHANT" "$USDC" || warn "the key is gone — nothing signs any more (expected)"

say "done — explorer: https://testnet.nearblocks.io/address/$GM"
