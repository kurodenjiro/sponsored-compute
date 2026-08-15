/**
 * Registry repo được tài trợ.
 *
 *   POST /api/registry   sponsor đăng ký repo SAU khi campaign đã fund
 *   GET  /api/registry   danh sách repo, kèm số dư đọc thẳng từ chain
 *
 * 🔴 Route này KHÔNG tin body. campaignId được TÍNH LẠI từ repo URL, rồi đối
 * chiếu với campaign thật trên chain. Không có campaign → không có hàng nào
 * được ghi. Người khác không đăng ký hộ được repo vào campaign của mình vì
 * campaignId chỉ có một cách sinh ra duy nhất (src/campaign.ts).
 */

import { NextResponse } from 'next/server';
import { DEFAULT_CHAIN_ID, getNetwork } from '../../../../src/config.js';
import { campaignIdOf, normalizeSponsor, parseRepoUrl, sponsorSlugOf } from '../../../../src/campaign.js';
import { getCampaign } from '../../../../src/grant.js';
import { codexManifest, installCommand, mcpManifest } from '../../../../src/init.js';
import { listRepos, registryStoreMode, saveRepo, type SponsoredRepo } from '../../../lib/registry-store';

export const dynamic = 'force-dynamic';

const fmt = (v: bigint, decimals = 6) => (Number(v) / 10 ** decimals).toFixed(decimals === 18 ? 4 : 2);

function grantManagerFor(chainId: number) {
  const gm = (process.env.GRANT_MANAGER ?? getNetwork(chainId).grantManager) as `0x${string}` | undefined;
  if (!gm) throw new Error(`no GrantManager is deployed for chain ${chainId}`);
  return gm;
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  try {
    const repo = parseRepoUrl(String(body.repoUrl ?? ''));
    const sponsor = normalizeSponsor(String(body.sponsor ?? sponsorSlugOf(repo)));
    const chainId = Number(body.chainId ?? DEFAULT_CHAIN_ID);
    const campaignId = campaignIdOf(repo, sponsor);

    if (body.campaignId && String(body.campaignId).toLowerCase() !== campaignId.toLowerCase()) {
      return NextResponse.json(
        { error: 'campaignId does not match the repository. It is derived from the repository URL and sponsor.', expected: campaignId },
        { status: 400 },
      );
    }

    const campaign = await getCampaign(grantManagerFor(chainId), campaignId, chainId);
    if (!campaign) {
      return NextResponse.json(
        { error: `No campaign exists on-chain for ${repo.slug}. Create and fund the campaign before registering.`, campaignId },
        { status: 409 },
      );
    }
    if (campaign.funded === 0n) {
      return NextResponse.json({ error: 'Campaign has no XSGD funded yet.', campaignId }, { status: 409 });
    }

    const record: SponsoredRepo = {
      campaignId,
      chainId,
      repoUrl: repo.url,
      repoSlug: repo.slug,
      sponsor,
      sponsorAddress: campaign.sponsor,
      grantAmount: campaign.grantAmount.toString(),
      funded: campaign.funded.toString(),
      committed: campaign.committed.toString(),
      asset: campaign.asset,
      tx: typeof body.tx === 'string' ? body.tx : undefined,
      createdAt: new Date().toISOString(),
    };
    await saveRepo(record);

    return NextResponse.json({
      ok: true,
      repo: record,
      // Thứ sponsor mang vào repo. Không phải bí mật — xem src/init.ts.
      install: installCommand({ campaignId, sponsor, chainId, repo: repo.url }),
      manifest: { version: 2, campaigns: [{ campaignId, sponsor, chainId, repo: repo.url }] },
      // .mcp.json: thứ làm "clone xong là chạy" — Claude Code tự nạp server này.
      mcp: mcpManifest(sponsor, chainId),
      // .codex/config.toml: cùng vai trò, dành cho Codex CLI.
      codex: codexManifest(sponsor, chainId),
      seats: Number((campaign.funded - campaign.committed) / campaign.grantAmount),
      storage: registryStoreMode,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage ?? e?.message ?? String(e) }, { status: 400 });
  }
}

export async function GET() {
  try {
    const repos = await listRepos();
    // Số liệu lưu trong DB có thể cũ (dev đã claim, sponsor đã nạp thêm).
    // Chain là nguồn sự thật; DB chỉ giữ ánh xạ repo → campaign.
    const live = await Promise.all(repos.map(async (repo) => {
      try {
        const campaign = await getCampaign(grantManagerFor(repo.chainId), repo.campaignId as `0x${string}`, repo.chainId);
        if (!campaign) return { ...repo, status: 'missing on-chain' as const };
        const available = campaign.funded - campaign.committed;
        return {
          ...repo,
          funded: campaign.funded.toString(),
          committed: campaign.committed.toString(),
          grantAmount: campaign.grantAmount.toString(),
          asset: campaign.asset,
          seatsLeft: Number(available / campaign.grantAmount),
          grantAmountLabel: fmt(campaign.grantAmount, campaign.asset === 1 ? 18 : 6),
          availableLabel: fmt(available, campaign.asset === 1 ? 18 : 6),
          symbol: campaign.asset === 1 ? 'AVAX' : 'XSGD',
          status: campaign.paused ? ('paused' as const) : ('open' as const),
        };
      } catch {
        return { ...repo, status: 'unreadable' as const };
      }
    }));
    return NextResponse.json({ repos: live, storage: registryStoreMode });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
