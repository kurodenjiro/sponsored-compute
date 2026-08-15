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

const MCP_JSON = {
  mcpServers: {
    'sponsored-compute': { command: 'npx', args: ['-y', '@sponsored-compute/mcp'] },
  },
};

export function runInit(o: InitOptions): string[] {
  const chainId = o.chainId ?? DEFAULT_CHAIN_ID;
  getNetwork(chainId); // từ chối chain lạ trước khi ghi file vào repo người dùng
  if (!/^0x[0-9a-fA-F]{64}$/.test(o.campaignId)) {
    throw new Error('campaignId phải là bytes32 dạng 0x + 64 ký tự hex');
  }
  const written: string[] = [];

  // ---- sponsored.json ----
  const spPath = `${o.cwd ?? '.'}/sponsored.json`;
  const prev = existsSync(spPath) ? JSON.parse(readFileSync(spPath, 'utf8')) : null;
  const campaigns: any[] = prev?.campaigns ?? [];

  if (!campaigns.some((c) => c.campaignId?.toLowerCase() === o.campaignId.toLowerCase())) {
    // projectId để TRỐNG — MCP xin từ sponsor lúc claim, mỗi dev một cái
    campaigns.push({ campaignId: o.campaignId, sponsor: o.sponsor });
  }

  writeFileSync(
    spPath,
    JSON.stringify({ version: 1, chainId, campaigns }, null, 2) + '\n',
  );
  written.push('sponsored.json');

  // ---- .mcp.json ----
  const mcpPath = `${o.cwd ?? '.'}/.mcp.json`;
  const existing = existsSync(mcpPath) ? JSON.parse(readFileSync(mcpPath, 'utf8')) : {};
  const merged = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}), ...MCP_JSON.mcpServers },
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
