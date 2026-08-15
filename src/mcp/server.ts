#!/usr/bin/env node
/**
 * MCP server — bề mặt DUY NHẤT mà agent (Claude Code / Codex / Cursor) nhìn thấy.
 *
 * 🔴 LUẬT 1 (SPONSORED-COMPUTE.md §6): CHỈ ba tool dưới đây.
 *    KHÔNG expose unwrap / sign / check_policy. Checkpoint chạy BÊN TRONG
 *    pay_for_service — LLM không thấy, không gọi được, không bỏ qua được.
 *
 * 🔴 Không tool nào trả về private key. Không có sign_anything.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { getSigner } from '../signer.js';
import { getGrantSource } from '../grant.js';
import { getNetwork, DEFAULT_CHAIN_ID, isMainnet } from '../config.js';
import { payX402, CheckpointDenied } from '../pay.js';
import { renderPlatforms, findPlatform } from './platforms.js';

const net = getNetwork();

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

const TOOLS = [
  {
    name: 'list_sponsored_platforms',
    description:
      'Liệt kê nền tảng cho một nhóm dịch vụ (database, monitoring...). ' +
      'LUÔN gồm cả lựa chọn KHÔNG tài trợ, xếp theo độ phù hợp kỹ thuật. ' +
      'CHỈ gọi khi người dùng hỏi — không tự gợi ý.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: 'vd "database", "monitoring"' } },
    },
  },
  {
    name: 'get_grant_status',
    description:
      'Trạng thái Grant hiện tại: đã vest bao nhiêu, đã tiêu bao nhiêu, trần, hạn dùng.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
    },
  },
  {
    name: 'pay_for_service',
    description:
      'Gọi một URL; nếu trả HTTP 402 thì tự thanh toán bằng Grant rồi thử lại. ' +
      'max_amount là trần cứng tính bằng đơn vị nguyên (1000000 = 1.00 SGD) — BẮT BUỘC. ' +
      'Nếu endpoint đòi nhiều hơn, hoặc không nằm trong allowlist của Grant, lệnh sẽ TỪ CHỐI.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        max_amount: { type: 'string', description: 'đơn vị nguyên, 6 decimals' },
        project_id: { type: 'string' },
        method: { type: 'string' },
        body: { type: 'object' },
      },
      required: ['url', 'max_amount'],
    },
  },
];

const server = new Server(
  { name: 'sponsored-compute', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params as any;

  try {
    switch (name) {
      case 'list_sponsored_platforms':
        return text(renderPlatforms(args.category));

      case 'get_grant_status': {
        const g = await getGrantSource().get(args.project_id ?? process.env.PROJECT_ID ?? '0x');
        if (!g) return text('Chưa có Grant cho dự án này. Hỏi người dùng chọn nền tảng trước.');
        const fmt = (v: bigint) => (Number(v) / 1e6).toFixed(2);
        return text(
          [
            `Grant ${g.grantId}  (project ${g.projectId})`,
            `  đã vest   : ${fmt(g.released)} / ${fmt(g.total)} SGD`,
            `  đã tiêu   : ${fmt(g.spent)} SGD  (hôm nay ${fmt(g.spentToday)})`,
            `  còn dùng  : ${fmt(g.released - g.spent)} SGD`,
            `  trần      : ${fmt(g.perTxCap)}/giao dịch · ${fmt(g.dailyCap)}/ngày`,
            `  hạn       : ${new Date(g.expiry * 1000).toISOString()}`,
            `  chỉ trả cho: ${g.allowedPayTo.join(', ') || '(chưa có)'}`,
            g.revoked ? '  ⚠️ ĐÃ BỊ THU HỒI' : '',
          ].filter(Boolean).join('\n'),
        );
      }

      case 'pay_for_service': {
        const signer = await getSigner();
        const grant = await getGrantSource().get(args.project_id ?? process.env.PROJECT_ID ?? '0x');

        /**
         * Khi có GRANT_MANAGER thì BẮT BUỘC đi qua unwrap() on-chain.
         * Thiếu chỗ này thì tiền lấy từ số dư riêng của agent, két Grant không
         * bị trừ, và lớp enforce ở contract KHÔNG được kích hoạt — chỉ còn
         * checkpoint phía client, mà client thì sửa được.
         */
        const grantManager = (process.env.GRANT_MANAGER ?? net.grantManager) as `0x${string}` | undefined;

        // ⟵ checkpoint chạy BÊN TRONG payX402. Không có đường vòng.
        const res = await payX402({
          url: args.url,
          method: args.method ?? 'POST',
          body: args.body,
          maxAmount: BigInt(args.max_amount),
          signer,
          grant,
          ...(grantManager && grant ? { grantManager, grantId: BigInt(grant.grantId) } : {}),
        });

        return text(
          [
            `HTTP ${res.status}` +
              (res.paidAmount > 0n ? ` · đã trả ${(Number(res.paidAmount) / 1e6).toFixed(2)} SGD` : ''),
            res.settlementHeader ? `settlement: ${res.settlementHeader}` : '',
            typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2),
          ].filter(Boolean).join('\n'),
        );
      }

      default:
        return text(`Tool không rõ: ${name}`);
    }
  } catch (e: any) {
    // Checkpoint từ chối là kết quả HỢP LỆ — báo rõ lý do, KHÔNG gợi ý cách lách.
    if (e instanceof CheckpointDenied) return text(e.message);
    return text(`Lỗi: ${e?.message ?? String(e)}`);
  }
});

async function main() {
  console.error(
    `[sponsored-compute] ${net.name}/${net.chainId}` +
      `${isMainnet() ? ' — 🔴 MAINNET, TIỀN THẬT' : ''} · facilitator ${net.facilitator}`,
  );
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error('[sponsored-compute] không khởi động được:', e);
  process.exit(1);
});
