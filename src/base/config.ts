/**
 * Base network registry — the EVM half of the project.
 *
 * Only Base. Avalanche, XSGD, AVAX gas grants and the 0xGasless facilitator were
 * removed on 26/08/2026: the merchants worth paying are on Base
 * (docs/ROADMAP-NEAR-MVP.md §2.2), and carrying a second EVM chain meant two
 * token registries, two facilitators and two EIP-712 domains to keep right.
 *
 * Same rule as before: addresses are never hardcoded anywhere else.
 */

export interface EvmToken {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /**
   * EIP-712 domain for EIP-3009. Read from the live contracts, not from a doc —
   * `name` differs between the two networks and a wrong one produces a signature
   * that fails with nothing but "invalid signature".
   */
  eip712: { name: string; version: string };
}

export interface BaseNetwork {
  chainId: 8453 | 84532;
  name: string;
  caip2: `eip155:${number}`;
  rpc: string;
  explorer: string;
  usdc: EvmToken;
  /**
   * x402 facilitator for this network.
   *
   * ⚠️ Needed only when we are the **seller**. In x402 the resource server is the
   * one that calls `/verify` and `/settle`; a buyer just signs and sends
   * `PAYMENT-SIGNATURE`. So paying a real merchant needs no facilitator on our
   * side at all — this field exists for `merchant-demo/` and for the optional
   * client-side pre-verify.
   */
  facilitator?: string;
}

export const BASE_NETWORKS: Record<number, BaseNetwork> = {
  84532: {
    chainId: 84532,
    name: 'base-sepolia',
    caip2: 'eip155:84532',
    rpc: process.env.BASE_RPC_URL ?? 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    usdc: {
      // Verified live 26/08/2026: name()="USDC", version()="2", decimals()=6.
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      symbol: 'USDC',
      decimals: 6,
      eip712: { name: 'USDC', version: '2' },
    },
    // Verified live 26/08/2026: GET /supported lists {v2, exact, eip155:84532}.
    // Free, no API key. This is where every payment test runs before mainnet.
    facilitator: process.env.X402_FACILITATOR ?? 'https://x402.org/facilitator',
  },
  8453: {
    chainId: 8453,
    name: 'base',
    caip2: 'eip155:8453',
    rpc: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    usdc: {
      // Verified live 26/08/2026: name()="USD Coin" — NOT "USDC" like Sepolia.
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      decimals: 6,
      eip712: { name: 'USD Coin', version: '2' },
    },
    /**
     * Left to the environment: every mainnet option needs a credential, so there
     * is no honest default. Only our own merchant needs this — paying someone
     * else's merchant on Base mainnet needs no facilitator of ours at all.
     *
     * Probed 26/08/2026:
     *   x402.org/facilitator   /supported has no eip155:8453 — testnet only
     *   thirdweb               https://api.thirdweb.com/v1/payments/x402
     *                          401 "x-secret-key or x-client-id header required";
     *                          self-serve key, EIP-7702 gasless settlement
     *   FastNEAR reference     https://base.x402.mikedotexe.com
     *                          /readyz healthy, /verify 401 "invalid_api_key";
     *                          key is approved by hand per resource server, and
     *                          the README states there is no availability SLA
     *
     * See docs/ROADMAP-NEAR-MVP.md §2.1c for which to pick and why.
     */
    facilitator: process.env.X402_FACILITATOR,
  },
};

/** Sepolia is the default: the network where being wrong is free. */
export const DEFAULT_CHAIN_ID = Number(process.env.BASE_CHAIN_ID ?? 84532);

export function getBaseNetwork(chainId = DEFAULT_CHAIN_ID): BaseNetwork {
  const n = BASE_NETWORKS[chainId];
  if (!n) throw new Error(`unsupported chainId ${chainId}. Have: ${Object.keys(BASE_NETWORKS).join(', ')}`);
  return n;
}

export function requireFacilitator(chainId = DEFAULT_CHAIN_ID): string {
  const f = getBaseNetwork(chainId).facilitator;
  if (!f) throw new Error(`no x402 facilitator configured for chainId ${chainId} - set X402_FACILITATOR`);
  return f;
}

/**
 * The facilitator still advertises v1 kinds under legacy names (`base-sepolia`)
 * next to v2 CAIP-2 (`eip155:84532`). Accept both on the way in; emit CAIP-2.
 */
export function toCaip2(network: string): string {
  const legacy: Record<string, string> = { 'base-sepolia': 'eip155:84532', base: 'eip155:8453' };
  return legacy[network] ?? network;
}
