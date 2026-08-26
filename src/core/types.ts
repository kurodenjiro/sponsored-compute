/**
 * Chain-agnostic domain model.
 *
 * The Avalanche-era types leaked EVM into every layer up to the UI
 * (docs/PROPOSAL-NEAR-chi-tiet.md §8.1): `signer: 0x${string}`, `chainId: number`,
 * `asset: 0 | 1`. A grant that lives on NEAR and spends on Base, Solana and
 * Bitcoin cannot be described that way, so identity, chain and asset become
 * strings with a declared namespace instead of EVM primitives.
 *
 * Nothing here knows about NEAR either — `src/near/*` and `src/checkpoint.ts`
 * are the two adapters that map their world onto this one.
 */

/** CAIP-2 chain id — `near:testnet`, `near:mainnet`, `eip155:8453`. */
export type Caip2 = string;

/** An account on some chain: a NEAR account id, or an EVM `0x…` address. */
export type Address = string;

/** A token: a NEP-141 contract account id, or an ERC-20 `0x…` address. */
export type AssetId = string;

/** Where a payment may land. Chain is part of the identity, not context. */
export interface Payee {
  chain: Caip2;
  address: Address;
}

export interface Asset {
  id: AssetId;
  symbol: string;
  decimals: number;
}

/**
 * A grant as the policy layer sees it — one snapshot, read from whichever chain
 * holds the ledger. Amounts are minor units of `asset`.
 */
export interface Grant {
  grantId: string;
  campaignId: string;
  /** Repo the grant is bound to (§7.2 layer 1); `''` for pre-NEAR grants. */
  repo: string;
  /**
   * Who is allowed to spend it: a NEAR public key on the access-key path, an
   * EVM address on the legacy path. Compared case-insensitively.
   */
  spender: string;
  /** Chain holding the ledger — where revocation takes effect. */
  homeChain: Caip2;
  asset: Asset;
  /** Chains this grant may pay on. One entry until Chain Signatures lands. */
  spendableChains: Caip2[];
  /** Tokens this grant may pay in — a 402 naming anything else is refused. */
  spendableAssets: AssetId[];
  /** Allowlist from the contract, never from a merchant's 402 challenge. */
  allowedPayees: Payee[];
  total: bigint;
  released: bigint;
  spent: bigint;
  spentToday: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  /** Unix seconds. */
  expiry: number;
  revoked: boolean;
}

/**
 * One payment a merchant is asking for, normalised out of its 402 challenge.
 * `amount` stays a string so a malformed one is a policy denial, not a throw.
 */
export interface PaymentIntent {
  chain: Caip2;
  asset: AssetId;
  payTo: Address;
  amount: string;
  /** x402 scheme — only `exact` is honoured. */
  scheme: string;
  /** How value actually moves: `eip3009`, `nep141`, `nep366`. */
  transferMethod: string;
}

/** NEAR account ids are lowercase by protocol; EVM addresses are not. */
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
