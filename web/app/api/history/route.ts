import { history, MERCHANT_NAME, PAY_TO, PRICE, EVIL, netInfo } from '../../../lib/x402';
import { paymentStoreMode } from '../../../lib/payment-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { merchant: MERCHANT_NAME, evil: EVIL, payTo: PAY_TO, price: PRICE, net: netInfo, store: paymentStoreMode, entries: await history() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
