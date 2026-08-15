import { qs, rest, usingSupabase } from './supabase';

export type PaymentEntry = {
  at: number;
  ok: boolean;
  payer?: string;
  amount: string;
  resource?: string;
  tx?: string;
  error?: string;
};

type Claim = { nonce: string; resource: string };
const CLAIM_TTL_SECONDS = 10 * 60;
const memoryLog: PaymentEntry[] = [];
const memoryClaims = new Map<string, number>();

function key({ nonce, resource }: Claim) { return `${nonce}:${resource}`; }

/** Atomically reserve an authorization nonce before settlement across instances. */
export async function claimPayment(claim: Claim): Promise<boolean> {
  if (!usingSupabase) {
    const now = Date.now();
    for (const [claimKey, claimedAt] of memoryClaims) if (now - claimedAt > CLAIM_TTL_SECONDS * 1000) memoryClaims.delete(claimKey);
    if (memoryClaims.has(key(claim))) return false;
    memoryClaims.set(key(claim), now);
    return true;
  }
  await rest(`sponsored_compute_claims?${qs({ expires_at: `lt.${new Date().toISOString()}` })}`, { method: 'DELETE' });
  const response = await rest('sponsored_compute_claims?on_conflict=nonce,resource', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([{ ...claim, expires_at: new Date(Date.now() + CLAIM_TTL_SECONDS * 1000).toISOString() }]),
  });
  return (await response.json()).length === 1;
}

export async function releaseClaim(claim: Claim) {
  if (!usingSupabase) { memoryClaims.delete(key(claim)); return; }
  await rest(`sponsored_compute_claims?${qs({ nonce: `eq.${claim.nonce}`, resource: `eq.${claim.resource}` })}`, { method: 'DELETE' });
}

export async function recordPayment(entry: PaymentEntry, claim?: Claim) {
  if (!usingSupabase) { memoryLog.push({ ...entry, resource: claim?.resource ?? entry.resource }); return; }
  await rest('sponsored_compute_payments', {
    method: 'POST',
    body: JSON.stringify([{
      nonce: claim?.nonce ?? null, resource: claim?.resource ?? null,
      created_at: new Date(entry.at).toISOString(), ok: entry.ok,
      payer: entry.payer ?? null, amount: entry.amount, tx: entry.tx ?? null, error: entry.error ?? null,
    }]),
  });
}

export async function paymentHistory(): Promise<PaymentEntry[]> {
  if (!usingSupabase) return memoryLog.slice(-20).reverse();
  const response = await rest('sponsored_compute_payments?select=created_at,ok,payer,amount,resource,tx,error&order=created_at.desc&limit=20');
  const rows = await response.json() as Array<{ created_at: string; ok: boolean; payer: string | null; amount: string; resource: string | null; tx: string | null; error: string | null }>;
  return rows.map((row) => ({ at: new Date(row.created_at).getTime(), ok: row.ok, payer: row.payer ?? undefined, amount: row.amount, resource: row.resource ?? undefined, tx: row.tx ?? undefined, error: row.error ?? undefined }));
}

export const paymentStoreMode = usingSupabase ? 'supabase-rest' : 'memory';
