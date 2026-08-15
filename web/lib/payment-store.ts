import { Pool } from 'pg';

export type PaymentEntry = {
  at: number;
  ok: boolean;
  payer?: string;
  amount: string;
  tx?: string;
  error?: string;
};

type Claim = { nonce: string; resource: string };

const CLAIM_TTL_SECONDS = 10 * 60;
const hasDatabase = Boolean(process.env.DATABASE_URL);
const memoryLog: PaymentEntry[] = [];
const memoryClaims = new Map<string, number>();

declare global {
  // eslint-disable-next-line no-var
  var sponsoredComputePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var sponsoredComputeSchema: Promise<void> | undefined;
}

function key({ nonce, resource }: Claim) {
  return `${nonce}:${resource}`;
}

function pool() {
  if (!hasDatabase) return null;
  if (!global.sponsoredComputePool) {
    global.sponsoredComputePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
    });
  }
  return global.sponsoredComputePool;
}

async function ensureSchema() {
  const db = pool();
  if (!db) return;
  global.sponsoredComputeSchema ??= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sponsored_compute_claims (
        nonce TEXT NOT NULL,
        resource TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (nonce, resource)
      );
      CREATE TABLE IF NOT EXISTS sponsored_compute_payments (
        id BIGSERIAL PRIMARY KEY,
        nonce TEXT,
        resource TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ok BOOLEAN NOT NULL,
        payer TEXT,
        amount TEXT NOT NULL,
        tx TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS sponsored_compute_payments_created_at
        ON sponsored_compute_payments (created_at DESC);
    `);
  })();
  await global.sponsoredComputeSchema;
}

/** Atomically reserve an authorization nonce before settlement across instances. */
export async function claimPayment(claim: Claim): Promise<boolean> {
  const db = pool();
  if (!db) {
    const now = Date.now();
    for (const [claimKey, claimedAt] of memoryClaims) {
      if (now - claimedAt > CLAIM_TTL_SECONDS * 1000) memoryClaims.delete(claimKey);
    }
    const claimKey = key(claim);
    if (memoryClaims.has(claimKey)) return false;
    memoryClaims.set(claimKey, now);
    return true;
  }

  await ensureSchema();
  await db.query(
    'DELETE FROM sponsored_compute_claims WHERE expires_at < NOW()',
  );
  const inserted = await db.query(
    `INSERT INTO sponsored_compute_claims (nonce, resource, expires_at)
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
     ON CONFLICT (nonce, resource) DO NOTHING
     RETURNING nonce`,
    [claim.nonce, claim.resource, CLAIM_TTL_SECONDS],
  );
  return inserted.rowCount === 1;
}

/** Release only a failed settlement so a fresh valid authorization can retry. */
export async function releaseClaim(claim: Claim) {
  const db = pool();
  if (!db) {
    memoryClaims.delete(key(claim));
    return;
  }
  await ensureSchema();
  await db.query(
    'DELETE FROM sponsored_compute_claims WHERE nonce = $1 AND resource = $2',
    [claim.nonce, claim.resource],
  );
}

export async function recordPayment(entry: PaymentEntry, claim?: Claim) {
  const db = pool();
  if (!db) {
    memoryLog.push(entry);
    return;
  }
  await ensureSchema();
  await db.query(
    `INSERT INTO sponsored_compute_payments
      (nonce, resource, created_at, ok, payer, amount, tx, error)
     VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8)`,
    [claim?.nonce ?? null, claim?.resource ?? null, entry.at, entry.ok, entry.payer ?? null, entry.amount, entry.tx ?? null, entry.error ?? null],
  );
}

export async function paymentHistory(): Promise<PaymentEntry[]> {
  const db = pool();
  if (!db) return memoryLog.slice(-20).reverse();
  await ensureSchema();
  const rows = await db.query<{
    at: Date; ok: boolean; payer: string | null; amount: string; tx: string | null; error: string | null;
  }>(
    `SELECT created_at AS at, ok, payer, amount, tx, error
     FROM sponsored_compute_payments
     ORDER BY created_at DESC
     LIMIT 20`,
  );
  return rows.rows.map((row) => ({
    at: row.at.getTime(), ok: row.ok, payer: row.payer ?? undefined,
    amount: row.amount, tx: row.tx ?? undefined, error: row.error ?? undefined,
  }));
}

export const paymentStoreMode = hasDatabase ? 'postgres' : 'memory';
