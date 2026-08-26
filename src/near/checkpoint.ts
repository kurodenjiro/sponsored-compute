/**
 * CHECKPOINT — NEAR adapter.
 *
 * Same decision function as the Base leg (`src/core/policy.ts`), fed from
 * NEAR terms: account ids instead of `0x` addresses, NEP-141 contract ids
 * instead of ERC-20 addresses, `near:testnet` instead of a numeric chain id.
 *
 * 🔴 RULE 1: not an MCP tool. It runs inside `pay_for_service()`.
 *
 * On this leg the contract enforces the identical rules a second time, and it
 * is the one that cannot be patched out — `pay_merchant` re-checks allowlist,
 * per-tx cap, daily cap, vesting and expiry before it moves a single token.
 */

import { evaluate } from '../core/policy.js';
import type { Decision } from '../core/policy.js';
import type { Grant, PaymentIntent } from '../core/types.js';
import { getNearNetwork } from './config.js';

/**
 * How value moves on NEAR today. `nep366` (SignedDelegate, facilitator-paid gas)
 * joins this list only once a facilitator that really supports `near:` has been
 * verified — see the note on `facilitator` in ./config.ts.
 */
export const NEAR_TRANSFER_METHODS = ['nep141'] as const;

/** One entry from a merchant's 402 `accepts` list, in NEAR terms. */
export interface NearPaymentRequirement {
  scheme: string;
  /** CAIP-2, e.g. `near:testnet`. */
  network: string;
  amount: string;
  /** NEP-141 contract account id. */
  asset: string;
  /** Merchant account id. */
  payTo: string;
  extra?: { assetTransferMethod?: string };
}

export function toNearIntent(req: NearPaymentRequirement): PaymentIntent {
  return {
    chain: req.network,
    asset: req.asset,
    payTo: req.payTo,
    amount: req.amount,
    scheme: req.scheme,
    transferMethod: req.extra?.assetTransferMethod ?? 'nep141',
  };
}

export interface NearCheckpointInput {
  req: NearPaymentRequirement;
  grant: Grant | null;
  /** Ceiling from `pay_for_service(url, max_amount)` — the outermost bound. */
  callerMax: bigint;
  /**
   * The agent's public key. Must equal `grant.spender`: a grant is looked up by
   * public data (campaign id + repo), so without this a poisoned repo config can
   * aim at someone else's grant. The chain refuses it too — `signer_account_pk`
   * decides there — but failing here costs no gas and no round trip.
   */
  publicKey?: string;
  now?: number;
  networkId?: string;
}

export function nearCheckpoint(input: NearCheckpointInput): Decision {
  // Guard against a challenge for some other NEAR network reaching a grant that
  // happens to be on this one; `spendableChains` catches it, this names it.
  getNearNetwork(input.networkId);
  return evaluate({
    intent: toNearIntent(input.req),
    grant: input.grant,
    callerMax: input.callerMax,
    spender: input.publicKey,
    allowedTransferMethods: NEAR_TRANSFER_METHODS,
    now: input.now,
  });
}
