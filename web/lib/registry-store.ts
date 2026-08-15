/**
 * Sổ tra cứu repo được tài trợ.
 *
 * 🔴 Store này KHÔNG cấp quyền gì. Nó chỉ chép lại thứ đã có trên chain để
 * người và agent tìm được nhau. Một hàng ở đây mà không có campaign on-chain
 * tương ứng là vô nghĩa — vì vậy route ghi vào đây luôn verify chain TRƯỚC.
 */

import { qs, rest, usingSupabase } from './supabase';

export type SponsoredRepo = {
  campaignId: string;
  chainId: number;
  repoUrl: string;
  repoSlug: string;
  sponsor: string;
  /** Ví đã tạo campaign — đọc từ chain, không nhận từ client. */
  sponsorAddress: string;
  /** atomic units, 6 decimals */
  grantAmount: string;
  funded: string;
  committed: string;
  tx?: string;
  createdAt: string;
};

export type GrantClaim = {
  projectId: string;
  campaignId: string;
  chainId: number;
  grantId: string;
  owner: string;
  signer: string;
  tx?: string;
  createdAt: string;
};

const memoryRepos = new Map<string, SponsoredRepo>();
const memoryClaims = new Map<string, GrantClaim>();

const REPOS = 'sponsored_compute_repos';
const CLAIMS = 'sponsored_compute_grant_claims';

function repoRow(repo: SponsoredRepo) {
  return {
    campaign_id: repo.campaignId.toLowerCase(),
    chain_id: repo.chainId,
    repo_url: repo.repoUrl,
    repo_slug: repo.repoSlug,
    sponsor: repo.sponsor,
    sponsor_address: repo.sponsorAddress,
    grant_amount: repo.grantAmount,
    funded: repo.funded,
    committed: repo.committed,
    tx: repo.tx ?? null,
    created_at: repo.createdAt,
  };
}

function toRepo(row: any): SponsoredRepo {
  return {
    campaignId: row.campaign_id,
    chainId: row.chain_id,
    repoUrl: row.repo_url,
    repoSlug: row.repo_slug,
    sponsor: row.sponsor,
    sponsorAddress: row.sponsor_address,
    grantAmount: row.grant_amount,
    funded: row.funded,
    committed: row.committed,
    tx: row.tx ?? undefined,
    createdAt: row.created_at,
  };
}

function claimRow(claim: GrantClaim) {
  return {
    project_id: claim.projectId.toLowerCase(),
    campaign_id: claim.campaignId.toLowerCase(),
    chain_id: claim.chainId,
    grant_id: claim.grantId,
    owner: claim.owner,
    signer: claim.signer,
    tx: claim.tx ?? null,
    created_at: claim.createdAt,
  };
}

function toClaim(row: any): GrantClaim {
  return {
    projectId: row.project_id,
    campaignId: row.campaign_id,
    chainId: row.chain_id,
    grantId: row.grant_id,
    owner: row.owner,
    signer: row.signer,
    tx: row.tx ?? undefined,
    createdAt: row.created_at,
  };
}

/** Đăng ký lại cùng một repo là hợp lệ: sponsor nạp thêm tiền thì số liệu phải mới. */
export async function saveRepo(repo: SponsoredRepo): Promise<void> {
  if (!usingSupabase) { memoryRepos.set(repo.campaignId.toLowerCase(), repo); return; }
  await rest(`${REPOS}?on_conflict=campaign_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([repoRow(repo)]),
  });
}

export async function listRepos(): Promise<SponsoredRepo[]> {
  if (!usingSupabase) return [...memoryRepos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const response = await rest(`${REPOS}?select=*&order=created_at.desc&limit=100`);
  return (await response.json() as any[]).map(toRepo);
}

export async function getRepo(campaignId: string): Promise<SponsoredRepo | null> {
  if (!usingSupabase) return memoryRepos.get(campaignId.toLowerCase()) ?? null;
  const response = await rest(`${REPOS}?${qs({ campaign_id: `eq.${campaignId.toLowerCase()}`, select: '*', limit: '1' })}`);
  const rows = await response.json() as any[];
  return rows.length ? toRepo(rows[0]) : null;
}

export async function saveClaim(claim: GrantClaim): Promise<void> {
  if (!usingSupabase) { memoryClaims.set(claim.projectId.toLowerCase(), claim); return; }
  await rest(`${CLAIMS}?on_conflict=project_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([claimRow(claim)]),
  });
}

export async function listClaims(campaignId?: string): Promise<GrantClaim[]> {
  if (!usingSupabase) {
    const all = [...memoryClaims.values()];
    const rows = campaignId ? all.filter((c) => c.campaignId.toLowerCase() === campaignId.toLowerCase()) : all;
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const filter = campaignId ? qs({ campaign_id: `eq.${campaignId.toLowerCase()}` }) + '&' : '';
  const response = await rest(`${CLAIMS}?${filter}select=*&order=created_at.desc&limit=100`);
  return (await response.json() as any[]).map(toClaim);
}

export const registryStoreMode = usingSupabase ? 'supabase-rest' : 'memory';
