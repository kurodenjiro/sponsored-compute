/**
 * Danh mục nền tảng.
 *
 * 🔴 BA LUẬT LIÊM CHÍNH (docs/SPONSORED-COMPUTE.md §6) — vi phạm là mất lý do tồn tại:
 *   1. LUÔN hiện cả lựa chọn KHÔNG tài trợ, đánh dấu rõ
 *   2. KHÔNG BAO GIỜ bán thứ hạng — xếp theo độ phù hợp kỹ thuật
 *   3. CHỈ hiện khi USER hỏi — agent không tự tạo nhu cầu
 */

export interface Platform {
  id: string;
  name: string;
  category: string;
  /** null = KHÔNG tài trợ. Vẫn phải hiện ra. */
  campaignId: string | null;
  sponsored: boolean;
  grantSgd: number | null;
  /** 0-100, do CON NGƯỜI đặt theo kỹ thuật — KHÔNG liên quan tới việc có tài trợ hay không */
  fitScore: number;
  note: string;
  x402: boolean;
}

export const PLATFORMS: Platform[] = [
  // --- database ---
  { id: 'supadb', name: 'SupaDB', category: 'database', sponsored: true,
    // campaign Fuji thật, không phải placeholder UI
    campaignId: '0x5fcee73cbbc7ac55687e8187df042e5b990c42d7032d57a20a2ca71ddf2b28f7',
    grantSgd: 2, fitScore: 88, x402: true,
    note: 'Managed Postgres with realtime and authentication included' },
  { id: 'neonlite', name: 'NeonLite', category: 'database', sponsored: true,
    // campaign Fuji thật, seed bằng SPONSOR=neonlite npx tsx scripts/seed.ts
    campaignId: '0x8c9cb9dd47a4d45a4bbd40d00489efa9a19ab6f8b17eb754dd53f37026aaeb5d',
    grantSgd: 1, fitScore: 81, x402: true,
    note: 'Serverless Postgres with separate compute and storage' },
  { id: 'postgres-self', name: 'PostgreSQL (self-hosted)', category: 'database', sponsored: false,
    campaignId: null, grantSgd: null, fitScore: 92, x402: false,
    note: 'Free and vendor-neutral. You operate it yourself.' },
  { id: 'sqlite', name: 'SQLite', category: 'database', sponsored: false,
    campaignId: null, grantSgd: null, fitScore: 74, x402: false,
    note: 'No server required. Well suited to small or edge projects.' },

  // --- monitoring ---
  { id: 'sentrywatch', name: 'SentryWatch', category: 'monitoring', sponsored: true,
    campaignId: '0x0000000000000000000000000000000000000000000000000000000000000003',
    grantSgd: 40, fitScore: 85, x402: true,
    note: 'Error monitoring and tracing' },
  { id: 'otel-self', name: 'OpenTelemetry (self-hosted)', category: 'monitoring', sponsored: false,
    campaignId: null, grantSgd: null, fitScore: 79, x402: false,
    note: 'Open standard with no vendor lock-in.' },
];

/**
 * Xếp theo fitScore GIẢM DẦN. Tài trợ KHÔNG ảnh hưởng thứ tự (Luật 2).
 * Lưu ý: postgres-self (92) đứng trên supadb (88) — đúng như thiết kế.
 */
export function listPlatforms(category?: string): Platform[] {
  const rows = category
    ? PLATFORMS.filter((p) => p.category.toLowerCase() === category.toLowerCase())
    : PLATFORMS;
  return [...rows].sort((a, b) => b.fitScore - a.fitScore);
}

export function renderPlatforms(category?: string): string {
  const rows = listPlatforms(category);
  if (rows.length === 0) return `No platforms found in the "${category}" category.`;

  const nS = rows.filter((r) => r.sponsored).length;
  const nU = rows.length - nS;

  const lines = rows.map((p, i) => {
    const tag = p.sponsored ? `[SPONSORED · ${p.grantSgd} SGD]` : '[UNSPONSORED]';
    return `${i + 1}. ${p.name} ${tag}\n   technical fit ${p.fitScore}/100 · ${p.x402 ? 'x402' : 'no x402'}\n   ${p.note}`;
  });

  return [
    `${nS} sponsored · ${nU} unsponsored — ranked by technical fit, NEVER by sponsorship.`,
    '',
    ...lines,
    '',
    'Which platform would you choose? (You decide, not the agent.)',
  ].join('\n');
}

export function findPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}
