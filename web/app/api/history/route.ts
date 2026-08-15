import { history, MERCHANT_NAME, PAY_TO, PRICE, EVIL, netInfo } from '../../../lib/x402';
import { paymentStoreMode } from '../../../lib/payment-store';
import { listClaims, listRepos } from '../../../lib/registry-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [entries, claims, repos] = await Promise.all([history(), listClaims(), listRepos()]);
  const claimBySigner = new Map(claims.map((claim) => [claim.signer.toLowerCase(), claim]));
  const repoByCampaign = new Map(repos.map((repo) => [repo.campaignId.toLowerCase(), repo]));
  const enriched = entries.map((entry) => {
    const claim = entry.payer ? claimBySigner.get(entry.payer.toLowerCase()) : undefined;
    const repo = claim ? repoByCampaign.get(claim.campaignId.toLowerCase()) : undefined;
    return { ...entry, projectId: claim?.projectId, grantId: claim?.grantId, repoSlug: repo?.repoSlug, repoUrl: repo?.repoUrl };
  });
  return Response.json(
    { merchant: MERCHANT_NAME, evil: EVIL, payTo: PAY_TO, price: PRICE, net: netInfo, store: paymentStoreMode, entries: enriched },
    { headers: { 'cache-control': 'no-store' } },
  );
}
