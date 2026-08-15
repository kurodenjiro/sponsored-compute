/**
 * Bước của DEVELOPER: clone repo → claim Grant.
 *
 * Thứ tự cố định, không đảo được:
 *   1. đọc sponsored.json  (con trỏ, KHÔNG đáng tin)
 *   2. verify campaign on-chain: tồn tại? · không pause? · còn đủ tiền chưa cam kết?
 *   3. projectId = f(campaignId, ví nhận thưởng) — mỗi ví một cái
 *   4. issueGrant() từ ví agent (tốn AVAX gas của chính dev)
 *   5. ghi projectId về sponsored.json
 *   6. báo registry — CHỈ để tra cứu; thất bại ở đây KHÔNG làm hỏng Grant
 *
 * `issueGrant` là permissionless: contract mới là bên enforce, không phải
 * server nào cả. Registry ở bước 6 chỉ chép lại thứ đã có trên chain.
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';
import { DEFAULT_CHAIN_ID, REGISTRY_URL, getNetwork } from './config.js';
import { projectIdOf } from './campaign.js';
import { ChainGrantSource, getCampaign } from './grant.js';
import { readManifest, recordProjectId, type CampaignPointer } from './init.js';
import { agentKey } from './unwrap.js';

const ISSUE_ABI = parseAbi([
  'function issueGrant(bytes32 campaignId, bytes32 projectId, address owner_, address signer_) returns (uint256)',
]);

/** Ghi cả struct Grant (11 slot) + push allowlist. 600k là dư, phần thừa được hoàn. */
const GAS = { gas: 600_000n, gasPrice: 25_000_000_000n };

export interface SponsorshipStatus {
  pointer: CampaignPointer;
  /** null = con trỏ trỏ vào campaign không tồn tại trên chain */
  campaign: Awaited<ReturnType<typeof getCampaign>>;
  claimable: boolean;
  reason: string;
  /** Grant đã tồn tại cho ví này (claim rồi) — đọc từ chain, không từ file. */
  grantId?: string;
  projectId?: string;
}

function grantManagerFor(chainId: number): `0x${string}` {
  const gm = (process.env.GRANT_MANAGER ?? getNetwork(chainId).grantManager) as `0x${string}` | undefined;
  if (!gm) throw new Error(`no GrantManager configured for chain ${chainId}`);
  return gm;
}

/**
 * "Dự án này có tài trợ không?" — trả lời bằng trạng thái on-chain, không bằng
 * nội dung file. Không ký gì, không tốn gas.
 */
export async function readSponsorship(opts: { wallet: string; cwd?: string }): Promise<SponsorshipStatus[]> {
  const manifest = readManifest(opts.cwd ?? '.');
  if (!manifest || manifest.campaigns.length === 0) return [];

  return Promise.all(manifest.campaigns.map(async (pointer): Promise<SponsorshipStatus> => {
    const chainId = pointer.chainId ?? DEFAULT_CHAIN_ID;
    try {
      const grantManager = grantManagerFor(chainId);
      const campaign = await getCampaign(grantManager, pointer.campaignId as `0x${string}`, chainId);
      if (!campaign) return { pointer, campaign: null, claimable: false, reason: 'campaign does not exist on this chain' };

      const projectId = projectIdOf(pointer.campaignId, opts.wallet);
      const existing = await new ChainGrantSource(grantManager, chainId).get(projectId);
      if (existing) {
        return { pointer, campaign, claimable: false, reason: 'already claimed by this wallet', grantId: existing.grantId, projectId };
      }
      if (campaign.paused) return { pointer, campaign, claimable: false, reason: 'campaign is paused', projectId };
      if (campaign.funded - campaign.committed < campaign.grantAmount) {
        return { pointer, campaign, claimable: false, reason: 'campaign funds are fully committed', projectId };
      }
      return { pointer, campaign, claimable: true, reason: 'ready to claim', projectId };
    } catch (e: any) {
      return { pointer, campaign: null, claimable: false, reason: e?.shortMessage ?? e?.message ?? String(e) };
    }
  }));
}

export interface ClaimResult {
  ok: boolean;
  campaignId: string;
  projectId?: string;
  grantId?: string;
  transaction?: `0x${string}`;
  /** Grant đã có sẵn từ trước — không phát thêm, không tốn gas. */
  alreadyClaimed?: boolean;
  registered?: boolean;
  registryError?: string;
  error?: string;
}

export async function claimSponsoredGrant(opts: {
  campaignId?: string;
  /** Ví NHẬN thưởng. Mặc định = ví agent. Nó sở hữu Grant, agent chỉ được ký. */
  rewardWallet?: string;
  chainId?: number;
  cwd?: string;
  /**
   * Nhãn cho campaign đến từ catalog chứ không từ sponsored.json — dev hỏi
   * "database nào có tài trợ?" rồi chọn một platform. Chỉ dùng để ghi con trỏ
   * sau khi claim; campaign vẫn được verify on-chain trước khi phát Grant.
   */
  sponsor?: string;
  repo?: string;
}): Promise<ClaimResult> {
  const cwd = opts.cwd ?? '.';
  const manifest = readManifest(cwd);

  const fromFile = opts.campaignId
    ? manifest?.campaigns.find((c) => c.campaignId?.toLowerCase() === opts.campaignId!.toLowerCase())
    : manifest?.campaigns[0];

  /**
   * Không có con trỏ trong repo nhưng người dùng đã nêu đích danh campaign thì
   * vẫn claim được: issueGrant là permissionless, Grant gắn vào ví của chính
   * người gọi, và campaign được đọc từ chain ngay bên dưới. Bắt buộc phải có
   * sponsored.json trước là rào cản giả — nó biến "chọn platform trong catalog"
   * thành ngõ cụt.
   */
  const pointer = fromFile ?? (opts.campaignId ? {
    campaignId: opts.campaignId,
    sponsor: opts.sponsor ?? 'catalog',
    chainId: opts.chainId ?? DEFAULT_CHAIN_ID,
    ...(opts.repo ? { repo: opts.repo } : {}),
  } satisfies CampaignPointer : undefined);

  if (!pointer) {
    return {
      ok: false,
      campaignId: opts.campaignId ?? '',
      error: 'this project has no sponsored.json, and no campaign was named — '
        + 'pick a platform from list_sponsored_platforms, or pass its campaign_id',
    };
  }

  const campaignId = pointer.campaignId as `0x${string}`;
  const chainId = opts.chainId ?? pointer.chainId ?? DEFAULT_CHAIN_ID;
  const net = getNetwork(chainId);
  const chain = chainId === 43114 ? avalanche : avalancheFuji;

  try {
    const grantManager = grantManagerFor(chainId);
    const account = privateKeyToAccount(await agentKey());
    const rewardWallet = (opts.rewardWallet ?? account.address) as `0x${string}`;
    const projectId = projectIdOf(campaignId, rewardWallet);
    const source = new ChainGrantSource(grantManager, chainId);

    // Claim lại không được phát Grant thứ hai: contract sẽ revert, nhưng dừng
    // sớm ở đây thì dev không mất gas cho một giao dịch chắc chắn hỏng.
    const existing = await source.get(projectId);
    if (existing) {
      recordProjectId(campaignId, projectId, cwd, pointer);
      const registry = await confirmWithRegistry({ campaignId, projectId, chainId, grantId: existing.grantId, owner: rewardWallet, signer: account.address, repo: pointer.repo });
      return { ok: true, campaignId, projectId, grantId: existing.grantId, alreadyClaimed: true, ...registry };
    }

    const campaign = await getCampaign(grantManager, campaignId, chainId);
    if (!campaign) return { ok: false, campaignId, projectId, error: `campaign does not exist on ${net.name}` };
    if (campaign.paused) return { ok: false, campaignId, projectId, error: 'campaign is paused; the sponsor stopped onboarding' };
    if (campaign.funded - campaign.committed < campaign.grantAmount) {
      return { ok: false, campaignId, projectId, error: 'campaign funds are fully committed; ask the sponsor to top it up' };
    }

    const pub = createPublicClient({ chain, transport: http(net.rpc) });
    const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });
    const hash = await wallet.writeContract({
      address: grantManager,
      abi: ISSUE_ABI,
      functionName: 'issueGrant',
      args: [campaignId, projectId, rewardWallet, account.address],
      ...GAS,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') return { ok: false, campaignId, projectId, transaction: hash, error: 'issueGrant reverted' };

    /**
     * Receipt về KHÔNG có nghĩa là mọi node RPC đã index xong block đó. Load
     * balancer trả read sang node chậm hơn ⇒ grantOf() ra 0 ⇒ báo "claim
     * failed" trong khi tiền ĐÃ commit on-chain. Hậu quả nặng: seat mất,
     * projectId không được ghi, agent vĩnh viễn không tìm ra Grant đã trả tiền.
     * Nên retry read: chỉ kết luận thất bại sau khi node thật sự bắt kịp.
     */
    let issued = await source.get(projectId);
    for (let attempt = 0; !issued && attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      issued = await source.get(projectId);
    }
    if (!issued) {
      return {
        ok: false, campaignId, projectId, transaction: hash,
        // projectId phải đi kèm: seat đã bị tiêu, dev cần nó để cứu Grant.
        error: `issueGrant confirmed (${hash}) but the Grant is still not readable. `
          + `The campaign seat IS committed on-chain — re-run the claim to record projectId ${projectId}.`,
      };
    }

    recordProjectId(campaignId, projectId, cwd, pointer);
    const registry = await confirmWithRegistry({ campaignId, projectId, chainId, grantId: issued.grantId, owner: rewardWallet, signer: account.address, transaction: hash, repo: pointer.repo });
    return { ok: true, campaignId, projectId, grantId: issued.grantId, transaction: hash, ...registry };
  } catch (e: any) {
    return { ok: false, campaignId, error: e?.shortMessage ?? e?.message ?? String(e) };
  }
}

/**
 * Bước 6 — sổ tra cứu. Cố tình best-effort: Grant đã nằm trên chain rồi, một
 * registry offline không được phép biến claim thành công thành thất bại.
 */
async function confirmWithRegistry(body: {
  campaignId: string;
  projectId: string;
  chainId: number;
  grantId: string;
  owner: string;
  signer: string;
  transaction?: string;
  repo?: string;
}): Promise<{ registered: boolean; registryError?: string }> {
  try {
    const res = await fetch(`${REGISTRY_URL}/api/registry/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { registered: false, registryError: `registry HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { registered: true };
  } catch (e: any) {
    return { registered: false, registryError: e?.message ?? String(e) };
  }
}
