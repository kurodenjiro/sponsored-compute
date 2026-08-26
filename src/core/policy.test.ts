/**
 * Policy tests — the DENY cases are what the demo turns on.
 *
 * Ported from the Avalanche-era `src/checkpoint.test.ts` when the decision moved
 * into the chain-agnostic core. Every case that guarded the old EVM path is kept;
 * the ones that only made sense for XSGD/AVAX were replaced with the cross-chain
 * guards that matter now — a NEAR grant must not pay a Base challenge unless the
 * grant itself says it can.
 *
 * Run: npx tsx src/core/policy.test.ts
 */

import { evaluate } from './policy.js';
import type { Grant, PaymentIntent } from './types.js';

const MERCHANT = '0x99a2B2962a6AC463FBe04664027Fdb3F68bd4Cc8';
const ATTACKER = '0x000000000000000000000000000000000000dEaD';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const SPENDER = '0xbeA48166Dd6f3563d843Ed8D9C615127497d82E0';
const BASE = 'eip155:84532';
const NEAR = 'near:testnet';
const NOW = 1_800_000_000;

const grant = (o: Partial<Grant> = {}): Grant => ({
  grantId: '1', campaignId: 'acme', repo: 'github.com/dev/repo',
  spender: SPENDER,
  homeChain: NEAR,
  asset: { id: USDC, symbol: 'USDC', decimals: 6 },
  spendableChains: [BASE],
  spendableAssets: [USDC],
  allowedPayees: [{ chain: BASE, address: MERCHANT }],
  total: 50_000000n, released: 10_000000n, spent: 0n, spentToday: 0n,
  perTxCap: 5_000000n, dailyCap: 8_000000n,
  expiry: NOW + 86400, revoked: false,
  ...o,
});

const intent = (o: Partial<PaymentIntent> = {}): PaymentIntent => ({
  chain: BASE, asset: USDC, payTo: MERCHANT, amount: '1000000',
  scheme: 'exact', transferMethod: 'eip3009',
  ...o,
});

const base = { callerMax: 5_000000n, allowedTransferMethods: ['eip3009'], now: NOW } as const;

let pass = 0, fail = 0;
function check(label: string, got: boolean, want: boolean, detail = '') {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  → ${detail}` : ''}`);
}
function deny(label: string, d: ReturnType<typeof evaluate>) {
  check(label, d.ok, false, d.ok ? '' : d.code);
}

// --- allow ---
{
  const d = evaluate({ ...base, intent: intent(), grant: grant() });
  check('allows when every condition holds', d.ok, true);
}
{
  // A matching spender must NOT be denied — guard against over-tightening the
  // NOT_MY_GRANT fix into rejecting the grant's rightful owner.
  const d = evaluate({ ...base, intent: intent(), grant: grant(), spender: SPENDER.toUpperCase() });
  check('allows when the spender matches (case-insensitive)', d.ok, true);
}
{
  // The NEAR leg: same policy, account ids instead of addresses.
  const d = evaluate({
    ...base,
    allowedTransferMethods: ['nep141'],
    intent: intent({ chain: NEAR, asset: 'usdc.fakes.testnet', payTo: 'neonlite.testnet', transferMethod: 'nep141' }),
    grant: grant({
      spendableChains: [NEAR], spendableAssets: ['usdc.fakes.testnet'],
      allowedPayees: [{ chain: NEAR, address: 'neonlite.testnet' }],
    }),
  });
  check('allows the NEAR leg with the same rules', d.ok, true);
}

// --- deny: the boundaries the demo turns on ---
deny('denies payTo outside the allowlist',
  evaluate({ ...base, intent: intent({ payTo: ATTACKER }), grant: grant() }));

deny('denies spending beyond the vested amount',
  evaluate({ ...base, intent: intent({ amount: '4000000' }), grant: grant({ released: 10_000000n, spent: 9_000000n }) }));

{
  // A merchant can write anything into the agent's context. A challenge that
  // carries an instruction is still just a challenge.
  const poisoned = intent({ payTo: ATTACKER, amount: '30000000' });
  deny('denies a 402 carrying an injection string', evaluate({ ...base, intent: poisoned, grant: grant() }));
}

deny('denies when there is no Grant', evaluate({ ...base, intent: intent(), grant: null }));
deny('denies a revoked Grant', evaluate({ ...base, intent: intent(), grant: grant({ revoked: true }) }));
deny('denies an expired Grant', evaluate({ ...base, intent: intent(), grant: grant({ expiry: NOW - 1 }) }));
deny('denies going over the caller max_amount',
  evaluate({ ...base, callerMax: 1_000000n, intent: intent({ amount: '3000000' }), grant: grant() }));
deny('denies going over the per-transaction cap',
  evaluate({ ...base, callerMax: 10_000000n, intent: intent({ amount: '6000000' }), grant: grant() }));
deny('denies going over the daily cap',
  evaluate({ ...base, intent: intent({ amount: '5000000' }), grant: grant({ spentToday: 4_000000n }) }));
deny('denies an unknown token', evaluate({ ...base, intent: intent({ asset: ATTACKER }), grant: grant() }));
deny('denies an unknown scheme', evaluate({ ...base, intent: intent({ scheme: 'upto' }), grant: grant() }));
deny('denies an unsupported transfer method',
  evaluate({ ...base, intent: intent({ transferMethod: 'permit2' }), grant: grant() }));
deny('denies a bad amount', evaluate({ ...base, intent: intent({ amount: 'lots' }), grant: grant() }));
deny('denies a zero amount', evaluate({ ...base, intent: intent({ amount: '0' }), grant: grant() }));

/**
 * The grant is looked up from public data (campaign id + repo), so without this
 * a poisoned repo config can aim a payment at someone else's grant and burn
 * their budget.
 */
deny('denies a Grant belonging to another spender',
  evaluate({ ...base, intent: intent(), grant: grant({ spender: ATTACKER }), spender: SPENDER }));

// --- cross-chain guards: new, and the reason the core exists ---
deny('denies a Base challenge against a NEAR-only Grant',
  evaluate({ ...base, intent: intent(), grant: grant({ spendableChains: [NEAR], spendableAssets: ['usdc.fakes.testnet'] }) }));

deny('denies Base mainnet when the Grant spends on Sepolia',
  evaluate({ ...base, intent: intent({ chain: 'eip155:8453' }), grant: grant() }));

{
  // Same bytes, different chain. An allowlist entry is (chain, address), not an
  // address that happens to be allowed somewhere.
  const d = evaluate({
    ...base,
    intent: intent({ chain: 'eip155:8453', asset: USDC }),
    grant: grant({ spendableChains: ['eip155:8453', BASE], allowedPayees: [{ chain: BASE, address: MERCHANT }] }),
  });
  deny('denies an allowlisted address on the wrong chain', d);
}

deny('denies a Grant that may spend nothing',
  evaluate({ ...base, intent: intent(), grant: grant({ spendableAssets: [] }) }));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
