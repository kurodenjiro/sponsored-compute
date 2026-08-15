import { history, MERCHANT_NAME, PAY_TO, PRICE, EVIL, netInfo } from '../../../lib/x402';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { merchant: MERCHANT_NAME, evil: EVIL, payTo: PAY_TO, price: PRICE, net: netInfo, entries: history() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
