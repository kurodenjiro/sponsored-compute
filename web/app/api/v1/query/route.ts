import { handlePayment } from '../../../../lib/x402';

export const dynamic = 'force-dynamic';

async function handle(req: Request) {
  const resource = new URL(req.url).href;
  const out = await handlePayment(req, resource);

  const common = { 'content-type': 'application/json', 'cache-control': 'no-store' };

  switch (out.kind) {
    case '402':
      return new Response(JSON.stringify(out.body), {
        status: 402,
        headers: { ...common, 'Payment-Required': out.header },
      });
    case '409':
      return new Response(JSON.stringify(out.body), { status: 409, headers: common });
    case '402-failed':
      return new Response(JSON.stringify(out.body), { status: 402, headers: common });
    case '200':
      return new Response(JSON.stringify(out.body), {
        status: 200,
        headers: { ...common, 'Payment-Response': out.header },
      });
  }
}

export const GET = handle;
export const POST = handle;
