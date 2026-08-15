import { DEFAULT_CHAIN_ID, getNetwork } from '../../../../src/config.js';
import { getCampaign } from '../../../../src/grant.js';
import { PLATFORMS } from '../../../../mcp/platforms.js';
import { listRepos } from '../../../lib/registry-store';

export const dynamic = 'force-dynamic';

const fmt = (value: bigint, asset: 0 | 1) => (Number(value) / 10 ** (asset === 1 ? 18 : 6)).toFixed(asset === 1 ? 4 : 2);

export async function GET() {
  const chainId = DEFAULT_CHAIN_ID;
  const grantManager = (process.env.GRANT_MANAGER ?? getNetwork(chainId).grantManager) as `0x${string}` | undefined;
  if (!grantManager) {
    return Response.json({ grants: [], error: `No GrantManager deployed for chain ${chainId}` }, { status: 503 });
  }

  const repos = await listRepos().catch(() => []);
  const repoByCampaign = new Map(repos.map((repo) => [repo.campaignId.toLowerCase(), repo]));
  const catalog = PLATFORMS.filter((platform) => platform.sponsored && platform.campaignId);
  const checks = await Promise.all(catalog.map(async (platform) => {
    try {
      const campaign = await getCampaign(grantManager, platform.campaignId as `0x${string}`, chainId);
      if (!campaign) return null;
      const available = campaign.funded - campaign.committed;
      const repo = repoByCampaign.get(platform.campaignId!.toLowerCase());
      return {
        id: platform.id,
        name: platform.name,
        category: platform.category,
        note: platform.note,
        fitScore: platform.fitScore,
        campaignId: platform.campaignId,
        chainId,
        grantAmount: campaign.grantAmount.toString(),
        grantAmountLabel: fmt(campaign.grantAmount, campaign.asset),
        available: available.toString(),
        availableLabel: fmt(available, campaign.asset),
        seatsLeft: campaign.grantAmount > 0n ? Number(available / campaign.grantAmount) : 0,
        perTxCapLabel: fmt(campaign.perTxCap, campaign.asset),
        dailyCapLabel: fmt(campaign.dailyCap, campaign.asset),
        asset: campaign.asset,
        symbol: campaign.asset === 1 ? 'AVAX' : 'XSGD',
        status: campaign.paused ? 'paused' : available >= campaign.grantAmount ? 'open' : 'exhausted',
        repoUrl: repo?.repoUrl,
        repoSlug: repo?.repoSlug,
      };
    } catch {
      return null;
    }
  }));

  return Response.json({
    grants: checks.filter(Boolean),
    chainId,
    source: 'mcp-catalog + on-chain GrantManager',
    catalogCount: catalog.length,
  }, { headers: { 'cache-control': 'no-store' } });
}
