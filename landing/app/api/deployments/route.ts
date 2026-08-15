import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const chainId = Number(process.env.CHAIN_ID ?? 43113);
  const file = join(process.cwd(), '..', 'deployments', `${chainId}.json`);
  return Response.json(JSON.parse(readFileSync(file, 'utf8')));
}
