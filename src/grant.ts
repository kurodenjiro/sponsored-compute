/**
 * Nguồn trạng thái Grant.
 *
 * Hiện có 2 nguồn:
 *  - ChainGrantSource  : đọc từ GrantManager on-chain  (mặc định)
 *  - LocalGrantSource  : đọc từ .grant-dev.json         (chỉ khi SPONSORED_LOCAL_GRANT=1)
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
  asset: 0 | 1;
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
      asset: g.asset === 1 ? 1 : 0,
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
  'function registry() view returns (address)',
  'function assetOfGrant(uint256 grantId) view returns (uint8)',
  'function campaigns(bytes32) view returns (address sponsor, bytes32 merchantId, uint256 funded, uint256 committed, uint256 grantAmount, uint32 trancheCount, uint32 tranchePeriod, uint256 minSpendPerTranche, uint32 minDaysPerTranche, uint64 grantValidity, uint256 perTxCap, uint256 dailyCap, address attestor, bool paused, uint8 asset)',
]);

const MERCHANT_REGISTRY_ABI = parseAbi([
  'function isAllowed(bytes32 id, address payTo) view returns (bool)',
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
  })) as readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, number, number, bigint, number, bigint, bigint, bigint, `0x${string}`, boolean, number];
  if (c[0] === '0x0000000000000000000000000000000000000000') return null;
  return { sponsor: c[0], merchantId: c[1], funded: c[2], committed: c[3], grantAmount: c[4], perTxCap: c[10], dailyCap: c[11], paused: c[13], asset: c[14] === 1 ? 1 : 0 };
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
    // Repo chưa claim thì caller truyền '0x' (hoặc chuỗi rỗng). Không chặn ở đây
    // thì viem ném lỗi bytes32 thô, nuốt mất nhánh `if (!grant)` của caller —
    // dev thấy stack trace viem thay vì "chưa có Grant". Sai projectId ⇒ không
    // thể có Grant, nên null mới là câu trả lời đúng.
    if (!/^0x[0-9a-fA-F]{64}$/.test(projectId)) return null;
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

    const asset = Number(await this.client.readContract({
      address: this.grantManager,
      abi: GRANT_MANAGER_ABI,
      functionName: 'assetOfGrant',
      args: [g[0]],
    })) === 1 ? 1 : 0;

    const candidates = (await this.client.readContract({
      address: this.grantManager,
      abi: GRANT_MANAGER_ABI,
      functionName: 'allowedPayTo',
      args: [g[0]],
    })) as `0x${string}`[];

    // Defense in depth for deployments made before allowedPayTo() itself was
    // made fail-closed: always read the live registry state again.
    const registry = await this.client.readContract({
      address: this.grantManager,
      abi: GRANT_MANAGER_ABI,
      functionName: 'registry',
    }) as `0x${string}`;
    const statuses = asset === 0 ? await Promise.all(candidates.map((payTo) => this.client.readContract({
      address: registry,
      abi: MERCHANT_REGISTRY_ABI,
      functionName: 'isAllowed',
      args: [g[1], payTo],
    }))) : [];
    const allowedPayTo = asset === 0 ? candidates.filter((_, index) => statuses[index]) : [];

    return {
      grantId: String(g[0]), merchantId: g[1], projectId, signer: g[2],
      allowedPayTo, asset,
      total: g[3], released: g[4], spent: g[5], spentToday: g[6],
      perTxCap: g[7], dailyCap: g[8],
      expiry: Number(g[9]), revoked: g[10],
    };
  }
}

/**
 * config.ts luôn khai báo grantManager cho cả Fuji lẫn mainnet, nên nhánh
 * `gm ? chain : local` khiến LocalGrantSource KHÔNG BAO GIỜ chạy — fixture
 * .grant-dev.json thành vô dụng dù tài liệu vẫn nói có. Nguồn local phải là
 * lựa chọn tường minh: dùng nhầm fixture thay cho state on-chain nghĩa là
 * checkpoint duyệt theo dữ liệu sửa được bằng tay, nên không thể để nó tự
 * bật theo cấu hình.
 */
export function getGrantSource(): GrantSource {
  if (process.env.SPONSORED_LOCAL_GRANT === '1') return new LocalGrantSource();
  const gm = (process.env.GRANT_MANAGER ?? getNetwork().grantManager) as `0x${string}` | undefined;
  if (!gm) throw new Error('no GrantManager for this network - set GRANT_MANAGER, or SPONSORED_LOCAL_GRANT=1 to use the dev fixture');
  return new ChainGrantSource(gm);
}
