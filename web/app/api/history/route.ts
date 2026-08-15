import { history, MERCHANT_NAME, PAY_TO, PRICE, EVIL, netInfo } from '../../../lib/x402';
import { paymentStoreMode } from '../../../lib/payment-store';
import { listClaims, listRepos } from '../../../lib/registry-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [entries, claims, repos] = await Promise.all([history(), listClaims(), listRepos()]);
  /**
   * Một ví dev có thể claim nhiều repo được tài trợ. Map khoá theo signer thì
   * claim sau ghi đè claim trước, nên MỌI giao dịch của ví đó bị gán vào đúng
   * một repo — sponsor đọc sổ sẽ thấy tiền của repo khác. Merchant chỉ nhìn
   * thấy địa chỉ người trả, không thấy grant nào cấp vốn, nên khi ví có nhiều
   * claim thì không thể quy kết: nói "không xác định" đúng hơn là đoán bừa.
   */
  const claimsBySigner = new Map<string, typeof claims>();
  for (const claim of claims) {
    const key = claim.signer.toLowerCase();
    claimsBySigner.set(key, [...(claimsBySigner.get(key) ?? []), claim]);
  }
  const repoByCampaign = new Map(repos.map((repo) => [repo.campaignId.toLowerCase(), repo]));
  const enriched = entries.map((entry) => {
    const candidates = entry.payer ? claimsBySigner.get(entry.payer.toLowerCase()) ?? [] : [];
    if (candidates.length !== 1) {
      return {
        ...entry,
        ...(candidates.length > 1
          ? { attribution: 'ambiguous' as const, candidateGrantIds: candidates.map((c) => c.grantId) }
          : { attribution: 'unknown' as const }),
      };
    }
    const [claim] = candidates;
    const repo = repoByCampaign.get(claim.campaignId.toLowerCase());
    return {
      ...entry, attribution: 'resolved' as const,
      projectId: claim.projectId, grantId: claim.grantId,
      repoSlug: repo?.repoSlug, repoUrl: repo?.repoUrl,
    };
  });
  return Response.json(
    { merchant: MERCHANT_NAME, evil: EVIL, payTo: PAY_TO, price: PRICE, net: netInfo, store: paymentStoreMode, entries: enriched },
    { headers: { 'cache-control': 'no-store' } },
  );
}
