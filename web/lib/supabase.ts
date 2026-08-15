/**
 * Supabase REST — dùng chung cho ledger thanh toán và registry repo.
 *
 * Không có Supabase thì mọi store rơi về bộ nhớ tiến trình: demo vẫn chạy,
 * nhưng dữ liệu mất khi restart. Đó là lý do `usingSupabase` được export —
 * bề mặt gọi nó phải nói thật đang chạy ở chế độ nào.
 */

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

export const usingSupabase = Boolean(supabaseUrl && supabaseKey);

export function qs(input: Record<string, string>) {
  return new URLSearchParams(input).toString();
}

export async function rest(path: string, init: RequestInit = {}) {
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${(await response.text()).slice(0, 280)}`);
  return response;
}
