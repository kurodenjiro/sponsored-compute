/** Regression tests for the merchant → self-relay authorization boundary. */
import { validateAuthorizationBinding } from './relayer.js';
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

check('cho phép authorization khớp hoá đơn', validateAuthorizationBinding(req, auth(), NOW), true);
check('chặn recipient khác dù chữ ký có thể hợp lệ', validateAuthorizationBinding(req, auth({ to: '0x000000000000000000000000000000000000dEaD' }), NOW), false);
check('chặn amount khác', validateAuthorizationBinding(req, auth({ value: '120001' }), NOW), false);
check('chặn authorization đã hết hạn', validateAuthorizationBinding(req, auth({ validBefore: String(NOW) }), NOW), false);
check('chặn chữ ký có lifetime quá dài', validateAuthorizationBinding(req, auth({ validBefore: String(NOW + 331) }), NOW), false);
check('chặn nonce không phải bytes32', validateAuthorizationBinding(req, auth({ nonce: '0x12' as `0x${string}` }), NOW), false);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
