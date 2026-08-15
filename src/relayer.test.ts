/** Regression tests for the merchant → self-relay authorization boundary. */
import { validateAuthorizationBinding, normalizeRelayerKey } from './relayer.js';
import type { Authorization, PaymentRequirement } from './x402.js';

const NOW = 1_800_000_000;
const PAY_TO = '0xd077E3f3048AD97C50A08a31a95F4918278B31ac' as const;

const req: PaymentRequirement = {
  scheme: 'exact', network: 'eip155:43113', chainId: 43113,
  amount: '120000', asset: '0xd769410dc8772695a7f55a304d2125320a65c2a5',
  payTo: PAY_TO, maxTimeoutSeconds: 300,
  extra: { assetTransferMethod: 'eip3009', name: 'XSGD', version: '2' },
};

const auth = (change: Partial<Authorization> = {}): Authorization => ({
  from: '0xbeA48166Dd6f3563d843Ed8D9C615127497d82E0', to: PAY_TO,
  value: '120000', validAfter: '0', validBefore: String(NOW + 300),
  nonce: (`0x${'11'.repeat(32)}`) as `0x${string}`, ...change,
});

let pass = 0;
let fail = 0;
function check(label: string, got: string | null, want: boolean) {
  const ok = (got === null) === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${got ? ` → ${got}` : ''}`);
}

check('allows an authorization matching the invoice', validateAuthorizationBinding(req, auth(), NOW), true);
check('denies a different recipient even with a valid signature', validateAuthorizationBinding(req, auth({ to: '0x000000000000000000000000000000000000dEaD' }), NOW), false);
check('denies a different amount', validateAuthorizationBinding(req, auth({ value: '120001' }), NOW), false);
check('denies an expired authorization', validateAuthorizationBinding(req, auth({ validBefore: String(NOW) }), NOW), false);
check('denies a signature whose lifetime is too long', validateAuthorizationBinding(req, auth({ validBefore: String(NOW + 331) }), NOW), false);
check('denies a nonce that is not bytes32', validateAuthorizationBinding(req, auth({ nonce: '0x12' as `0x${string}` }), NOW), false);

/**
 * RELAYER_PRIVATE_KEY took production down: a value pasted into the Vercel
 * dashboard reached privateKeyToAccount as an unusable string, viem threw
 * "invalid private key, expected hex or 32 bytes, got string", and the route
 * answered 500 with no ledger row — after the agent had already unwrapped
 * funds from the Grant. Trim the wrapper, reject anything else out loud.
 */
const KEY = '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const accepts: [string, string][] = [
  ['already prefixed', `0x${KEY}`],
  ['missing the 0x prefix', KEY],
  ['wrapped in double quotes', `"0x${KEY}"`],
  ['wrapped in single quotes', `'0x${KEY}'`],
  ['padded with whitespace and a newline', `  0x${KEY}\n`],
];
for (const [label, raw] of accepts) {
  let got: string;
  try { got = normalizeRelayerKey(raw); } catch (e: any) { got = `threw: ${e.message}`; }
  check(`normalizes a relayer key ${label}`, got === `0x${KEY}` ? null : got, true);
}

const rejects: [string, string][] = [
  ['an empty value', ''],
  ['a truncated key', `0x${KEY.slice(0, 40)}`],
  ['non-hex characters', `0x${'z'.repeat(64)}`],
  ['a whole JSON blob', `{"privateKey":"0x${KEY}"}`],
];
for (const [label, raw] of rejects) {
  let threw = false;
  try { normalizeRelayerKey(raw); } catch { threw = true; }
  check(`rejects ${label}`, threw ? null : 'accepted a bad key', true);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
