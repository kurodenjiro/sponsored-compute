/**
 * Network registry. Địa chỉ KHÔNG bao giờ hardcode ở nơi khác —
 * mọi thứ resolve theo chainId từ đây (xem docs/SPONSORED-COMPUTE.md §7.6).
 */

export interface TokenConfig {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** EIP-712 domain — XSGD KHÔNG expose version()/DOMAIN_SEPARATOR(), phải hardcode. */
  eip712: { name: string; version: string };
}

export interface NetworkConfig {
  chainId: number;
  name: string;
  caip2: string;
  rpc: string;
  explorer: string;
  facilitator: string;
  /** GrantManager của deployment Sponsored Compute chính thức cho network này. */
  grantManager?: `0x${string}`;
  tokens: Record<string, TokenConfig>;
}

export const NETWORKS: Record<number, NetworkConfig> = {
  43113: {
    chainId: 43113,
    name: 'avalanche-fuji',
    caip2: 'eip155:43113',
    rpc: 'https://api.avax-test.network/ext/bc/C/rpc',
    explorer: 'https://testnet.snowtrace.io',
    // verified live: /list → supportedAssets gồm XSGD 0xd769…c2a5, không cần API key
    facilitator: 'https://x402.0xgasless.com',
    grantManager: '0x3230B5666d8De86d3079D07bb45A7075A1d0b043',
    tokens: {
      XSGD: {
        address: '0xd769410dc8772695a7f55a304d2125320a65c2a5',
        symbol: 'XSGD',
        decimals: 6,
        eip712: { name: 'XSGD', version: '2' },
      },
      USDC: {
        address: '0x5425890298aed601595a70ab815c96711a31bc65',
        symbol: 'USDC',
        decimals: 6,
        eip712: { name: 'USD Coin', version: '2' },
      },
    },
  },
  43114: {
    chainId: 43114,
    name: 'avalanche',
    caip2: 'eip155:43114',
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    explorer: 'https://snowtrace.io',
    facilitator: 'https://x402.0xgasless.com',
    tokens: {
      XSGD: {
        address: '0xb2f85b7ab3c2b6f62df06de6ae7d09c010a5096e',
        symbol: 'XSGD',
        decimals: 6,
        eip712: { name: 'XSGD', version: '2' },
      },
    },
  },
};

/**
 * TESTNET (Fuji 43113) là mặc định — an toàn khi phát triển.
 *
 * ⚠️ TRƯỚC KHI NỘP: slide hackathon yêu cầu
 *    "All solutions must make use of $XSGD on Avalanche C-Chain Mainnet."
 *    Lật sang mainnet bằng:   CHAIN_ID=43114 npm run dev ...
 *    Cả hai chain đều đã verify: facilitator /verify + card API trả 402 đúng.
 */
export const DEFAULT_CHAIN_ID = Number(process.env.CHAIN_ID ?? 43113);

export function getNetwork(chainId = DEFAULT_CHAIN_ID): NetworkConfig {
  const n = NETWORKS[chainId];
  if (!n) throw new Error(`Chưa hỗ trợ chainId ${chainId}. Có: ${Object.keys(NETWORKS).join(', ')}`);
  return n;
}

export function isMainnet(chainId = DEFAULT_CHAIN_ID) {
  return chainId === 43114;
}

/**
 * StraitsX card — KHÔNG có trong docs.straitsx.com (grep llms.txt: 0 hit).
 * Chỉ tồn tại cho AgentiX Playground → probe live là spec duy nhất.
 * Cả hai env đều verified trả 402 đúng định dạng (15/08/2026).
 */
export const CARD_ENV = {
  43114: {
    mcpSse: 'https://card.straitsx.ai/production/sse',
    issueUrl: 'https://card.straitsx.ai/production/cardapi/issue_card',
  },
  43113: {
    mcpSse: 'https://card.straitsx.ai/sandbox/sse',
    issueUrl: 'https://card.straitsx.ai/sandbox/cardapi/issue_card',
  },
} as const;

export const CARD_LIMITS = { minSgd: 5, maxSgd: 30, nameMin: 2, nameMax: 26 };

export function getCardEnv(chainId = DEFAULT_CHAIN_ID) {
  const c = CARD_ENV[chainId as 43114 | 43113];
  if (!c) throw new Error(`Không có card env cho chainId ${chainId}`);
  return c;
}
