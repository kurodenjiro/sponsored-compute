/**
 * Nguồn trạng thái Grant.
 *
 * Hiện có 2 nguồn:
 *  - ChainGrantSource  : đọc từ GrantManager on-chain  (dùng khi contract đã deploy)
 *  - LocalGrantSource  : đọc từ .grant-dev.json         (dev/test, KHÔNG dùng khi demo)
 *
 * Checkpoint chỉ nhận GrantView — không quan tâm nguồn nào.
 */

import { createPublicClient, http, parseAbi } from 'viem';
import { existsSync, readFileSync } from 'node:fs';
import { getNetwork } from './config.js';
import type { GrantView } from './checkpoint.js';

export interface GrantSource {
  get(projectId: string): Promise<GrantView | null>;
  kind: string;
}

export interface CampaignView {
  sponsor: `0x${string}`;
  merchantId: `0x${string}`;
  funded: bigint;
  committed: bigint;
  grantAmount: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  paused: boolean;
}

// ---------------------------------------------------------------- local (dev)

const DEV_FILE = '.grant-dev.json';

export class LocalGrantSource implements GrantSource {
  kind = 'local-dev-file';
  constructor(private file = DEV_FILE) {}

  async get(projectId: string): Promise<GrantView | null> {
    if (!existsSync(this.file)) return null;
    const raw = JSON.parse(readFileSync(this.file, 'utf8'));
    const g = Array.isArray(raw) ? raw.find((x) => x.projectId === projectId) : raw;
    if (!g) return null;
    return {
      ...g,
      total: BigInt(g.total),
      released: BigInt(g.released),
      spent: BigInt(g.spent ?? 0),
      spentToday: BigInt(g.spentToday ?? 0),
      perTxCap: BigInt(g.perTxCap),
      dailyCap: BigInt(g.dailyCap),
    } as GrantView;
  }
}

// ---------------------------------------------------------------- on-chain

/** Khớp CHÍNH XÁC chữ ký trong GrantManager.sol — grantId là uint256, không phải bytes32. */
export const GRANT_MANAGER_ABI = parseAbi([
  'function grantOf(bytes32 projectId) view returns (uint256 grantId, bytes32 merchantId, address signer, uint256 total, uint256 released, uint256 spent, uint256 spentToday, uint256 perTxCap, uint256 dailyCap, uint64 expiry, bool revoked)',
  'function allowedPayTo(uint256 grantId) view returns (address[])',
  'function campaigns(bytes32) view returns (address sponsor, bytes32 merchantId, uint256 funded, uint256 committed, uint256 grantAmount, uint32 trancheCount, uint32 tranchePeriod, uint256 minSpendPerTranche, uint32 minDaysPerTranche, uint64 grantValidity, uint256 perTxCap, uint256 dailyCap, address attestor, bool paused)',
]);

/** Kiểm campaign trước onboarding; không ghi con trỏ tới campaign giả hoặc đã pause. */
export async function getCampaign(
  grantManager: `0x${string}`,
  campaignId: `0x${string}`,
  chainId?: number,
): Promise<CampaignView | null> {
  const net = getNetwork(chainId);
  const client = createPublicClient({ transport: http(net.rpc) });
  const c = (await client.readContract({
    address: grantManager, abi: GRANT_MANAGER_ABI, functionName: 'campaigns', args: [campaignId],
  })) as readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, number, number, bigint, number, bigint, bigint, bigint, `0x${string}`, boolean];
  if (c[0] === '0x0000000000000000000000000000000000000000') return null;
  return { sponsor: c[0], merchantId: c[1], funded: c[2], committed: c[3], grantAmount: c[4], perTxCap: c[10], dailyCap: c[11], paused: c[13] };
}

export class ChainGrantSource implements GrantSource {
  kind = 'on-chain';
  private client;

  constructor(
    private grantManager: `0x${string}`,
    chainId?: number,
  ) {
    const net = getNetwork(chainId);
    this.client = createPublicClient({ transport: http(net.rpc) });
  }

  async get(projectId: string): Promise<GrantView | null> {
    const pid = projectId as `0x${string}`;
    const g = (await this.client.readContract({
      address: this.grantManager,
      abi: GRANT_MANAGER_ABI,
      functionName: 'grantOf',
      args: [pid],
    })) as readonly [
      bigint, `0x${string}`, `0x${string}`,
      bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean,
    ];

    if (g[0] === 0n) return null;

    const allowedPayTo = (await this.client.readContract({
      address: this.grantManager,
      abi: GRANT_MANAGER_ABI,
      functionName: 'allowedPayTo',
      args: [g[0]],
    })) as `0x${string}`[];

    return {
      grantId: String(g[0]), merchantId: g[1], projectId, signer: g[2],
      allowedPayTo,
      total: g[3], released: g[4], spent: g[5], spentToday: g[6],
      perTxCap: g[7], dailyCap: g[8],
      expiry: Number(g[9]), revoked: g[10],
    };
  }
}

export function getGrantSource(): GrantSource {
  const gm = (process.env.GRANT_MANAGER ?? getNetwork().grantManager) as `0x${string}` | undefined;
  return gm ? new ChainGrantSource(gm) : new LocalGrantSource();
}
