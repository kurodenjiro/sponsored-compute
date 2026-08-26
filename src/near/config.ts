/**
 * NEAR network registry — the NEAR counterpart of `src/config.ts`.
 *
 * Same rule as the Avalanche registry: account ids are never hardcoded anywhere
 * else. Everything resolves through `getNearNetwork()`.
 */

export interface NearToken {
  /** NEP-141 contract account id. */
  id: string;
  symbol: string;
  decimals: number;
}

export interface NearNetwork {
  networkId: 'testnet' | 'mainnet';
  caip2: `near:${'testnet' | 'mainnet'}`;
  rpc: string;
  explorer: string;
  /** Deployed grant-manager. Also the account every grant access key sits on. */
  grantManager?: string;
  tokens: Record<string, NearToken>;
  /**
   * x402 facilitator that settles `near:` payments.
   *
   * One exists and is live — FastNEAR's Rust facilitator, verified 26/08/2026:
   * `/supported` returns `exact @ near:testnet` and `exact @ near:mainnet`, v2.
   * Recorded here because it is real, **not** because the agent can use it.
   *
   * ⚠️ The agent cannot pay through it, and that is by design. The NEAR mechanism
   * requires a NEP-366 delegate whose single action is `ft_transfer` with
   * `receiver_id` equal to the **token contract**
   * (crates/x402-chain-near/src/mechanism.rs). Our agent's key is a FunctionCall
   * access key pinned to `grant-manager` and two methods, so the protocol itself
   * refuses to sign that delegate. Any key that could sign it would be a key that
   * can move the account's tokens directly — the exact capability this project
   * removes.
   *
   * So this field is for the **seller** side: a NEAR merchant of ours accepting
   * x402 from third-party agents. Access is manually approved per resource
   * server, and the endpoints carry no availability SLA.
   */
  facilitator?: string;
}

export const NEAR_NETWORKS: Record<string, NearNetwork> = {
  testnet: {
    networkId: 'testnet',
    caip2: 'near:testnet',
    rpc: process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.near.org',
    explorer: 'https://testnet.nearblocks.io',
    grantManager: process.env.NEAR_GRANT_MANAGER ?? 'gm.anyone3-pay.testnet',
    // Verified live 26/08/2026 — see the note on `facilitator` above before use.
    facilitator: process.env.NEAR_X402_FACILITATOR ?? 'https://test.x402.mikedotexe.com',
    tokens: {
      // Verified live 26/08/2026: ft_metadata → { symbol: "USDC.e", decimals: 6 }.
      USDC: { id: 'usdc.fakes.testnet', symbol: 'USDC.e', decimals: 6 },
    },
  },
  mainnet: {
    networkId: 'mainnet',
    caip2: 'near:mainnet',
    rpc: process.env.NEAR_RPC_URL ?? 'https://rpc.mainnet.near.org',
    explorer: 'https://nearblocks.io',
    grantManager: process.env.NEAR_GRANT_MANAGER,
    facilitator: process.env.NEAR_X402_FACILITATOR ?? 'https://x402.mikedotexe.com',
    tokens: {
      // Verified live 26/08/2026: ft_metadata → { symbol: "USDC", decimals: 6 }.
      USDC: {
        id: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
        symbol: 'USDC',
        decimals: 6,
      },
    },
  },
};

/** Testnet is the default — the safe one to be wrong about. */
export const DEFAULT_NEAR_NETWORK = process.env.NEAR_NETWORK ?? 'testnet';

export function getNearNetwork(networkId = DEFAULT_NEAR_NETWORK): NearNetwork {
  const n = NEAR_NETWORKS[networkId];
  if (!n) throw new Error(`unknown NEAR network "${networkId}". Have: ${Object.keys(NEAR_NETWORKS).join(', ')}`);
  return n;
}

export function requireGrantManager(networkId = DEFAULT_NEAR_NETWORK): string {
  const n = getNearNetwork(networkId);
  if (!n.grantManager) {
    throw new Error(`no grant-manager deployed on NEAR ${networkId} - set NEAR_GRANT_MANAGER`);
  }
  return n.grantManager;
}

export function tokenById(id: string, networkId = DEFAULT_NEAR_NETWORK): NearToken | undefined {
  return Object.values(getNearNetwork(networkId).tokens).find((t) => t.id === id);
}

/** NEP-141 `storage_deposit` for one account — exactly 0.00125 NEAR (§4.4). */
export const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n;
