/**
 * The grant signer is the only place a Base payment can be authorised, so these
 * tests are the Base-leg equivalent of the contract's policy tests.
 *
 * What they pin down: `wrapFetchWithPayment` answers a 402 by itself, so the
 * checkpoint cannot live in the request flow — it lives in `signTypedData`, and
 * nothing reaches a signature without passing it. They also cover the domain
 * checks, which matter because the typed data (not the challenge) is what
 * actually gets signed.
 *
 * Run: npx tsx src/base/signer.test.ts
 */

import { createGrantSigner, CheckpointDenied, type EvmSignatureRequester } from './pay.js';
import { getBaseNetwork } from './config.js';
import type { Grant } from '../core/types.js';

const CHAIN = 84532;
const net = getBaseNetwork(CHAIN);
const FROM = '0x7De1259Cc50963091551B29DA22fDd01a0b8Ca79' as const;
const MERCHANT = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C' as const;
const ATTACKER = '0x000000000000000000000000000000000000dEaD' as const;
const NONCE = ('0x' + '11'.repeat(32)) as `0x${string}`;
const SIG = ('0x' + 'ab'.repeat(65)) as `0x${string}`;
const NOW = 1_800_000_000;

const grant: Grant = {
  grantId: '1', campaignId: 'acme', repo: 'github.com/dev/repo',
  spender: FROM, homeChain: 'near:testnet',
  asset: { id: net.usdc.address, symbol: 'USDC', decimals: 6 },
  spendableChains: [net.caip2],
  spendableAssets: [net.usdc.address],
  allowedPayees: [{ chain: net.caip2, address: MERCHANT }],
  total: 50_000000n, released: 10_000000n, spent: 0n, spentToday: 0n,
  perTxCap: 5_000000n, dailyCap: 8_000000n,
  expiry: NOW + 86400, revoked: false,
};

/** Records what the contract would have been asked for, and answers with a stub. */
function recorder() {
  const calls: Parameters<EvmSignatureRequester['requestSignature']>[0][] = [];
  const requester: EvmSignatureRequester = {
    async requestSignature(input) { calls.push(input); return SIG; },
  };
  return { calls, requester };
}

function signer(over: { grant?: Grant; callerMax?: bigint } = {}) {
  const { calls, requester } = recorder();
  const s = createGrantSigner({
    address: FROM,
    grant: over.grant ?? grant,
    callerMax: over.callerMax ?? 5_000000n,
    requester, chainId: CHAIN, now: NOW,
  });
  return { s, calls };
}

const typedData = (o: {
  primaryType?: string;
  domain?: Record<string, unknown>;
  message?: Record<string, unknown>;
} = {}) => ({
  primaryType: o.primaryType ?? 'TransferWithAuthorization',
  types: {},
  domain: {
    name: net.usdc.eip712.name, version: net.usdc.eip712.version,
    chainId: CHAIN, verifyingContract: net.usdc.address,
    ...o.domain,
  },
  message: {
    from: FROM, to: MERCHANT, value: 1_000000n,
    validAfter: 0n, validBefore: BigInt(NOW + 300), nonce: NONCE,
    ...o.message,
  },
});

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? `  → ${detail}` : ''}`);
}
async function refuses(label: string, td: ReturnType<typeof typedData>, over = {}) {
  const { s, calls } = signer(over);
  try {
    await s.signTypedData(td);
    ok(label, false, 'it signed');
  } catch (e) {
    // Refusing must also mean never troubling the contract with it.
    ok(label, calls.length === 0, calls.length ? 'reached the contract anyway' : (e as Error).name);
  }
}

async function main() {
  // --- the happy path, and what the contract is actually asked for ---
  {
    const { s, calls } = signer();
    const sig = await s.signTypedData(typedData());
    ok('signs a payment that passes every check', sig === SIG);
    const c = calls[0];
    ok('passes fields, never a digest', c !== undefined && !('digest' in c) && !('hash' in c));
    ok('forwards the campaign, merchant and amount unchanged',
      c?.campaignId === 'acme' && c?.to === MERCHANT && c?.amount === 1_000000n);
    ok('forwards the validity window the contract will bind its reservation to',
      c?.validBefore === BigInt(NOW + 300) && c?.nonce === NONCE);
  }

  // --- the checkpoint, running on the bytes about to be signed ---
  await refuses('refuses a merchant outside the allowlist', typedData({ message: { to: ATTACKER } }));
  await refuses('refuses over the per-transaction cap', typedData({ message: { value: 6_000000n } }));
  await refuses('refuses over the caller max', typedData({ message: { value: 3_000000n } }), { callerMax: 1_000000n });
  await refuses('refuses a revoked grant', typedData(), { grant: { ...grant, revoked: true } });
  await refuses('refuses an expired grant', typedData(), { grant: { ...grant, expiry: NOW - 1 } });
  await refuses('refuses beyond the vested amount', typedData(), { grant: { ...grant, released: 0n } });

  // --- the domain: what the signature would actually be valid against ---
  await refuses('refuses a foreign token contract',
    typedData({ domain: { verifyingContract: ATTACKER } }));
  await refuses('refuses another chain in the domain', typedData({ domain: { chainId: 8453 } }));
  await refuses('refuses a mismatched EIP-712 domain name',
    typedData({ domain: { name: 'USD Coin' } }));   // mainnet's name, on Sepolia
  await refuses('refuses a mismatched EIP-712 version', typedData({ domain: { version: '1' } }));
  await refuses('refuses a struct that is not TransferWithAuthorization',
    typedData({ primaryType: 'Permit' }));
  await refuses('refuses paying from an address this grant does not control',
    typedData({ message: { from: ATTACKER } }));
  await refuses('refuses a malformed nonce', typedData({ message: { nonce: '0xdeadbeef' } }));

  // A denial has to be recognisable so pay_for_service can explain it without
  // suggesting a way around it.
  {
    const { s } = signer();
    try {
      await s.signTypedData(typedData({ message: { to: ATTACKER } }));
      ok('a policy denial surfaces as CheckpointDenied', false, 'it signed');
    } catch (e) {
      ok('a policy denial surfaces as CheckpointDenied', e instanceof CheckpointDenied,
        (e as Error).message.slice(0, 60));
    }
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
