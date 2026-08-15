/**
 * Lệnh cài đặt chung cho landing page — KHÔNG gắn campaign nào, chỉ nối MCP
 * server cho agent để thử platform demo / list_sponsored_platforms.
 *
 * Tính server-side vì lệnh phụ thuộc SPONSORED_CLI_SPEC (biến môi trường,
 * không nên lộ ra client như NEXT_PUBLIC_* — cùng nguồn sự thật với
 * /api/registry để không có hai chỗ phải sửa khi đổi package spec).
 */

import { NextResponse } from 'next/server';
import { installCommand } from '../../../../src/init.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    claude: installCommand({ client: 'claude' }),
    codex: installCommand({ client: 'codex' }),
  });
}
