/**
 * `sponsored-compute init` — lệnh mà sponsor copy vào terminal (hoặc dán vào
 * README của repo mẫu). Ghi hai file vào dự án hiện tại:
 *
 *   sponsored.json   con trỏ tới campaign  (KHÔNG phải giấy phép — xem §7.2)
 *   .mcp.json        khai báo MCP server, Claude Code tự nạp khi mở project
 *
 * KHÔNG ghi bí mật, KHÔNG ghi địa chỉ ví, KHÔNG ghi địa chỉ contract.
 * Địa chỉ resolve theo chainId lúc chạy từ src/config.ts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_CHAIN_ID, getNetwork } from './config.js';

export interface InitOptions {
  campaignId: string;
  sponsor: string;
  chainId?: number;
  cwd?: string;
}

type CampaignPointer = { campaignId: string; sponsor: string; chainId: number };

function serverName(sponsor: string, chainId: number) {
  const slug = sponsor.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign';
  return `sponsored-compute-${slug}-${chainId}`;
}

function serverConfig() {
  return { command: 'npx', args: ['-y', '@sponsored-compute/mcp'] };
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
  }));

  const existingCampaign = campaigns.find((c) => c.campaignId?.toLowerCase() === o.campaignId.toLowerCase());
  if (existingCampaign && existingCampaign.chainId !== chainId) {
    throw new Error(`campaign ${o.campaignId} is already configured for chain ${existingCampaign.chainId}`);
  }
  if (!existingCampaign) {
    campaigns.push({ campaignId: o.campaignId, sponsor: o.sponsor, chainId });
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

  return written;
}

/** Lệnh một dòng để sponsor dán vào README hoặc terminal. */
export function installCommand(campaignId: string, sponsor: string, chainId = DEFAULT_CHAIN_ID) {
  getNetwork(chainId);
  const net = chainId === 43114 ? '' : ` --chain ${chainId}`;
  return `npx -y @sponsored-compute/cli init --campaign ${campaignId} --sponsor ${sponsor}${net}`;
}
