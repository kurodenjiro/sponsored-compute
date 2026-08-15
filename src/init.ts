/**
 * `sponsored-compute init` — lệnh mà sponsor copy vào terminal (hoặc dán vào
 * README của repo mẫu). Ghi ba file vào dự án hiện tại:
 *
 *   sponsored.json      con trỏ tới campaign  (KHÔNG phải giấy phép — xem §7.2)
 *   .mcp.json           Claude Code tự nạp khi mở project
 *   .codex/config.toml  Codex CLI tự nạp cho project đã trust (project-scoped MCP)
 *
 * KHÔNG ghi bí mật, KHÔNG ghi địa chỉ ví, KHÔNG ghi địa chỉ contract.
 * Địa chỉ resolve theo chainId lúc chạy từ src/config.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_CHAIN_ID, getNetwork } from './config.js';

export interface InitOptions {
  campaignId: string;
  sponsor: string;
  chainId?: number;
  cwd?: string;
  /** URL repo được tài trợ — chỉ để người đọc đối chiếu, không cấp quyền gì. */
  repo?: string;
}

export type CampaignPointer = {
  campaignId: string;
  sponsor: string;
  chainId: number;
  repo?: string;
  /** Ghi vào SAU khi dev claim thành công. Sponsor không bao giờ ghi sẵn. */
  projectId?: string;
};

export type Manifest = { version: number; campaigns: CampaignPointer[] };

function serverName(sponsor: string, chainId: number) {
  const slug = sponsor.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign';
  return `sponsored-compute-${slug}-${chainId}`;
}

/**
 * Package spec dùng trong lệnh cài và trong .mcp.json.
 *
 * Mặc định là tên trên npm. Khi chưa publish (hackathon), trỏ thẳng vào repo:
 *   SPONSORED_CLI_SPEC=github:owner/x402-hack
 *   SPONSORED_MCP_SPEC=github:owner/x402-hack
 * npm chạy `prepare` sau khi clone git dep nên dist/ được build tại chỗ.
 */
export const CLI_SPEC = process.env.SPONSORED_CLI_SPEC ?? '@sponsored-compute/cli';
export const MCP_SPEC = process.env.SPONSORED_MCP_SPEC ?? '@sponsored-compute/mcp';

function serverConfig() {
  // Spec dạng github: cài cả package, nên phải gọi đúng bin thay vì tên package.
  return MCP_SPEC.startsWith('github:') || MCP_SPEC.includes('/') && !MCP_SPEC.startsWith('@')
    ? { command: 'npx', args: ['-y', '--package', MCP_SPEC, 'sponsored-compute-mcp'] }
    : { command: 'npx', args: ['-y', MCP_SPEC] };
}

/**
 * Codex CLI đọc MCP server từ TOML — `[mcp_servers.<name>]` — chứ không phải
 * .mcp.json. Ghi vào `.codex/config.toml` TRONG REPO (project-scoped, chỉ chạy
 * cho project đã trust — xem developers.openai.com/codex/mcp), KHÔNG BAO GIỜ
 * đụng vào `~/.codex/config.toml` của máy dev: đó là config toàn máy, không
 * phải thứ một `init` chạy trong một thư mục dự án được phép sửa.
 */
function codexBlock(name: string, cfg: { command: string; args: string[] }): string {
  const args = cfg.args.map((a) => JSON.stringify(a)).join(', ');
  return `[mcp_servers.${name}]\ncommand = ${JSON.stringify(cfg.command)}\nargs = [${args}]`;
}

/** Nội dung `.codex/config.toml` mà init sẽ ghi — để sponsor console xem trước. */
export function codexManifest(sponsor: string, chainId = DEFAULT_CHAIN_ID): string {
  return codexBlock(serverName(sponsor, chainId), serverConfig()) + '\n';
}

export function runInit(o: InitOptions): string[] {
  const chainId = o.chainId ?? DEFAULT_CHAIN_ID;
  getNetwork(chainId); // reject unknown chains before writing into a user repository
  if (!/^0x[0-9a-fA-F]{64}$/.test(o.campaignId)) {
    throw new Error('campaignId must be a bytes32 value: 0x followed by 64 hex characters');
  }
  const written: string[] = [];

  // ---- sponsored.json ----
  const spPath = `${o.cwd ?? '.'}/sponsored.json`;
  const prev = existsSync(spPath) ? JSON.parse(readFileSync(spPath, 'utf8')) : null;
  const campaigns: CampaignPointer[] = (prev?.campaigns ?? []).map((campaign: any) => ({
    campaignId: campaign.campaignId,
    sponsor: campaign.sponsor,
    // Migrate v1 safely: it stored one shared chainId at the document root.
    chainId: campaign.chainId ?? prev?.chainId,
    ...(campaign.repo ? { repo: campaign.repo } : {}),
    ...(campaign.projectId ? { projectId: campaign.projectId } : {}),
  }));

  const existingCampaign = campaigns.find((c) => c.campaignId?.toLowerCase() === o.campaignId.toLowerCase());
  if (existingCampaign && existingCampaign.chainId !== chainId) {
    throw new Error(`campaign ${o.campaignId} is already configured for chain ${existingCampaign.chainId}`);
  }
  if (existingCampaign) {
    if (o.repo) existingCampaign.repo = o.repo;
  } else {
    campaigns.push({ campaignId: o.campaignId, sponsor: o.sponsor, chainId, ...(o.repo ? { repo: o.repo } : {}) });
  }

  writeFileSync(
    spPath,
    JSON.stringify({ version: 2, campaigns }, null, 2) + '\n',
  );
  written.push('sponsored.json');

  // ---- .mcp.json ----
  const mcpPath = `${o.cwd ?? '.'}/.mcp.json`;
  const existing = existsSync(mcpPath) ? JSON.parse(readFileSync(mcpPath, 'utf8')) : {};
  const name = serverName(o.sponsor, chainId);
  const nextServer = serverConfig();
  const currentServer = existing.mcpServers?.[name];
  if (currentServer && JSON.stringify(currentServer) !== JSON.stringify(nextServer)) {
    throw new Error(`MCP server "${name}" already exists with a different configuration; resolve it manually instead of overwriting it.`);
  }
  const merged = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}), [name]: nextServer },
  };
  writeFileSync(mcpPath, JSON.stringify(merged, null, 2) + '\n');
  written.push('.mcp.json');

  // ---- .codex/config.toml ----
  // Không có parser TOML ở đây, nên chỉ tự cho phép đúng MỘT thứ: kiểm tra
  // khối của CHÍNH MÌNH (byte-for-byte, vì mình luôn sinh ra cùng một chuỗi)
  // đã có sẵn hay chưa. Header trùng mà nội dung khác → dừng, không đoán ý
  // người đã sửa tay — giống hệt luật của .mcp.json ở trên.
  const codexDir = `${o.cwd ?? '.'}/.codex`;
  const codexPath = `${codexDir}/config.toml`;
  const codexHeader = `[mcp_servers.${name}]`;
  const codexBlockText = codexBlock(name, nextServer);
  const existingToml = existsSync(codexPath) ? readFileSync(codexPath, 'utf8') : '';
  if (!existingToml.includes(codexBlockText)) {
    if (existingToml.includes(`${codexHeader}\n`) || existingToml.trimEnd().endsWith(codexHeader)) {
      throw new Error(`Codex MCP server "${name}" already exists in .codex/config.toml with a different configuration; resolve it manually instead of overwriting it.`);
    }
    if (!existsSync(codexDir)) mkdirSync(codexDir, { recursive: true });
    const sep = existingToml.length ? (existingToml.endsWith('\n\n') ? '' : existingToml.endsWith('\n') ? '\n' : '\n\n') : '';
    writeFileSync(codexPath, `${existingToml}${sep}${codexBlockText}\n`);
  }
  written.push('.codex/config.toml');

  return written;
}

/**
 * Lệnh một dòng sponsor console trả về sau khi fund — thứ duy nhất sponsor
 * phải mang vào repo. Nó KHÔNG phải token, không phải giấy phép: chạy nó chỉ
 * ghi hai file con trỏ, và ai cũng chạy được. Quyền nằm ở Grant on-chain.
 */
export function installCommand(o: { campaignId: string; sponsor: string; chainId?: number; repo?: string }) {
  const chainId = o.chainId ?? DEFAULT_CHAIN_ID;
  getNetwork(chainId);
  const chain = chainId === 43114 ? '' : ` --chain ${chainId}`;
  const repo = o.repo ? ` --repo ${o.repo}` : '';
  const runner = CLI_SPEC.startsWith('github:') ? `npx -y --package ${CLI_SPEC} sponsored-compute` : `npx -y ${CLI_SPEC}`;
  return `${runner} init --campaign ${o.campaignId} --sponsor ${o.sponsor}${repo}${chain}`;
}

/** Nội dung .mcp.json mà init sẽ ghi — để sponsor console xem trước, không phải đoán. */
export function mcpManifest(sponsor: string, chainId = DEFAULT_CHAIN_ID) {
  return { mcpServers: { [serverName(sponsor, chainId)]: serverConfig() } };
}

/** Đọc con trỏ trong repo. Dữ liệu này KHÔNG đáng tin — luôn verify on-chain sau đó. */
export function readManifest(cwd = '.'): Manifest | null {
  const path = `${cwd}/sponsored.json`;
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const campaigns: CampaignPointer[] = (raw?.campaigns ?? []).map((c: any) => ({
    campaignId: c.campaignId,
    sponsor: c.sponsor,
    chainId: c.chainId ?? raw?.chainId ?? DEFAULT_CHAIN_ID,
    ...(c.repo ? { repo: c.repo } : {}),
    ...(c.projectId ? { projectId: c.projectId } : {}),
  }));
  return { version: raw?.version ?? 1, campaigns };
}

/** Ghi projectId về manifest sau khi Grant đã phát xong on-chain. */
export function recordProjectId(campaignId: string, projectId: string, cwd = '.'): void {
  const manifest = readManifest(cwd);
  if (!manifest) throw new Error('sponsored.json not found; run init in the repository root first');
  const pointer = manifest.campaigns.find((c) => c.campaignId?.toLowerCase() === campaignId.toLowerCase());
  if (!pointer) throw new Error(`sponsored.json has no pointer to campaign ${campaignId}`);
  pointer.projectId = projectId;
  writeFileSync(`${cwd}/sponsored.json`, JSON.stringify({ version: 2, campaigns: manifest.campaigns }, null, 2) + '\n');
}
