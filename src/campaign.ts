/**
 * Danh tính campaign — SUY RA TỪ REPO, không phải từ tên do người nhập.
 *
 * Sponsor chỉ nhập URL repo GitHub. Mọi id on-chain sinh ra ở đây, và cả ba
 * bề mặt (web sponsor console, CLI, MCP) đều gọi CHÍNH module này — lệch một
 * chữ là campaignId lệch, con trỏ trong repo trỏ vào campaign không tồn tại.
 *
 *   merchantId  = keccak(sponsor slug)                    ← allowlist payTo
 *   campaignId  = keccak("campaign:<merchantId>:<host>/<owner>/<repo>")
 *   projectId   = keccak("project:<campaignId>:<ví dev>") ← mỗi dev một cái
 *
 * projectId KHÔNG nằm trong repo lúc sponsor phát hành: nó sinh lúc dev claim,
 * theo ví của chính dev đó. Người fork repo dùng lại projectId cũ sẽ bị
 * GrantManager từ chối (ProjectAlreadyGranted) — fork không nhân bản được tiền.
 */

import { keccak256, stringToHex } from 'viem';

export interface RepoRef {
  /** ví dụ "github.com" — giữ lại để campaignId của GitLab không đụng GitHub */
  host: string;
  owner: string;
  name: string;
  /** "owner/name", đã lowercase */
  slug: string;
  /** URL chuẩn hoá, dùng để hiển thị và để `git clone` */
  url: string;
}

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Nhận mọi dạng người ta hay dán vào: URL https, SSH, hoặc "owner/repo".
 * Ném lỗi thay vì đoán — campaignId sai thì tiền nằm ở campaign không ai tới được.
 */
export function parseRepoUrl(input: string): RepoRef {
  const raw = input.trim();
  if (!raw) throw new Error('Repository URL is required.');

  let host = 'github.com';
  let path = raw;

  const ssh = raw.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    host = ssh[1];
    path = ssh[2];
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`Not a valid repository URL: ${raw}`);
    }
    host = parsed.hostname;
    path = parsed.pathname;
  } else if (raw.includes('/') && raw.split('/')[0].includes('.')) {
    // "github.com/owner/repo" — dán từ thanh địa chỉ, thiếu scheme
    const [maybeHost, ...rest] = raw.split('/');
    host = maybeHost;
    path = rest.join('/');
  }

  const parts = path.replace(/\.git$/i, '').split('/').filter(Boolean);
  if (parts.length < 2) throw new Error(`Repository URL must include owner and repository: ${raw}`);

  const owner = parts[0].toLowerCase();
  const name = parts[1].toLowerCase();
  host = host.toLowerCase().replace(/^www\./, '');
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    throw new Error(`Repository owner and name may only contain letters, digits, ".", "_" and "-": ${raw}`);
  }

  return { host, owner, name, slug: `${owner}/${name}`, url: `https://${host}/${owner}/${name}` };
}

/** Tên sponsor mặc định = owner của repo. Dùng làm merchant slug. */
export function sponsorSlugOf(repo: RepoRef): string {
  return repo.owner;
}

export function normalizeSponsor(sponsor: string): string {
  const slug = sponsor.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error('Sponsor name must contain at least one letter or digit.');
  return slug;
}

export function merchantIdOf(sponsor: string): `0x${string}` {
  return keccak256(stringToHex(normalizeSponsor(sponsor)));
}

export function campaignIdOf(repo: RepoRef, sponsor = sponsorSlugOf(repo)): `0x${string}` {
  return keccak256(stringToHex(`campaign:${merchantIdOf(sponsor)}:${repo.host}/${repo.slug}`));
}

/** Một ví — một Grant cho mỗi campaign. Claim lại chỉ đọc lại Grant cũ. */
export function projectIdOf(campaignId: string, wallet: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(campaignId)) throw new Error(`campaignId must be bytes32: ${campaignId}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error(`wallet must be an address: ${wallet}`);
  return keccak256(stringToHex(`project:${campaignId.toLowerCase()}:${wallet.toLowerCase()}`));
}

/**
 * Hiển thị số tiền 6 decimals: tối thiểu 2 chữ số thập phân, nhưng KHÔNG làm
 * tròn mất số nhỏ — campaign 100 atomic mà in "0.00" thì người ta tưởng rỗng.
 */
export function formatAmount(atomic: bigint, decimals = 6): string {
  const negative = atomic < 0n;
  const v = negative ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, '0');
  const significant = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${v / base}.${frac.slice(0, Math.max(2, significant.length))}`;
}

/**
 * Trần chi tiêu suy ra theo cỡ Grant, không hardcode.
 * Một Grant 2 XSGD và một Grant 200 XSGD không thể dùng chung perTxCap.
 */
export function capsFor(grantAtomic: bigint) {
  return { perTxCap: grantAtomic / 4n, dailyCap: grantAtomic / 2n };
}
