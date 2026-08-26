#!/usr/bin/env -S npx tsx
/**
 * A merchant we control, so the Base leg can be tested end to end.
 *
 * `https://x402.org/protected` proves our client reads a real 402, but its price
 * and `payTo` are fixed by someone else — we cannot use it to test a refusal, a
 * cap, or settlement into an address we can inspect. This is that merchant.
 *
 * Pattern taken from vercel-labs/x402-ai-starter (archived 25/06/2026, one day
 * after x402 v2 shipped), ported from the v1 `x402-next` packages to `@x402/express`.
 *
 * ⚠️ What is deliberately NOT copied from that template: its buyer side. There,
 * a CDP server wallet named "Purchaser" auto-refills from a faucet and pays for
 * any tool the model calls, and the only spending control in the whole repo is a
 * line of system prompt:
 *
 *     system: "ALWAYS prompt the user to confirm before authorizing payments"
 *
 * That is authority living in the model's context, which is exactly the thing any
 * merchant can write into. It is the failure mode this project exists to remove —
 * see docs/ROADMAP-NEAR-MVP.md §6.
 *
 * Usage:  MERCHANT_PAYTO=0x… npm run merchant
 */

import express from 'express';
import { paymentMiddlewareFromConfig } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { getBaseNetwork, DEFAULT_CHAIN_ID } from '../src/base/config.js';

const chainId = Number(process.env.BASE_CHAIN_ID ?? DEFAULT_CHAIN_ID);
const net = getBaseNetwork(chainId);
const port = Number(process.env.MERCHANT_PORT ?? 4041);

const payTo = process.env.MERCHANT_PAYTO;
if (!payTo) {
  // No default. A plausible-looking address here would send real testnet
  // settlements to a wallet nobody owns, and the failure would look like ours.
  console.error('set MERCHANT_PAYTO to the address this merchant should be paid at');
  process.exit(1);
}
if (!net.facilitator) {
  console.error(`no facilitator configured for chain ${chainId} - set X402_FACILITATOR`);
  process.exit(1);
}

const price = process.env.MERCHANT_PRICE ?? '$0.01';
const app = express();

app.use(
  paymentMiddlewareFromConfig(
    {
      'GET /quote': {
        accepts: { scheme: 'exact', payTo, price, network: net.caip2 },
        description: 'A price quote for one unit of imaginary compute',
        serviceName: 'NeonLite (demo merchant)',
      },
    },
    new HTTPFacilitatorClient({ url: net.facilitator }),
    // The scheme has to be registered explicitly: it is what turns a "$0.01"
    // price into an asset + atomic amount for this network, and what verifies
    // the payload on the way back in.
    [{ network: net.caip2, server: new ExactEvmScheme() }],
  ),
);

app.get('/quote', (_req, res) => {
  res.json({ unit: 'vCPU-hour', quote: 0.042, currency: 'USD', at: new Date().toISOString() });
});

/** Unpaid on purpose: somewhere to confirm the server is up without a 402. */
app.get('/health', (_req, res) => res.json({ ok: true, network: net.caip2, payTo, price }));

app.listen(port, () => {
  console.log(`merchant-demo on http://localhost:${port}`);
  console.log(`  paid   GET /quote    ${price}  ${net.caip2}  → ${payTo}`);
  console.log(`  free   GET /health`);
  console.log(`  facilitator ${net.facilitator}`);
});
