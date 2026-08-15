import { DEFAULT_CHAIN_ID, getNetwork } from '../../../../src/config.js';
import { getCampaign } from '../../../../src/grant.js';
import { PLATFORMS } from '../../../../mcp/platforms.js';
import { listRepos } from '../../../lib/registry-store';

export const dynamic = 'force-dynamic';

const fmt = (value: bigint) => (Number(value) / 1e6).toFixed(2);

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
        grantAmountLabel: fmt(campaign.grantAmount),
        available: available.toString(),
        availableLabel: fmt(available),
        seatsLeft: campaign.grantAmount > 0n ? Number(available / campaign.grantAmount) : 0,
        perTxCapLabel: fmt(campaign.perTxCap),
        dailyCapLabel: fmt(campaign.dailyCap),
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
