#!/usr/bin/env -S npx tsx
/**
 * Two read-only checks against a live x402 merchant on Base Sepolia.
 * No money moves: the signature requester refuses, so nothing is ever signed.
 *
 *   1. price check — read the 402 without paying, the way an agent should
 *      before it decides anything
 *   2. wiring check — let the real SDK drive our grant signer with the real
 *      merchant's typed data, and print exactly what the contract would be
 *      asked to sign
 *
 * Usage: npm run base:probe [url]
 */

import { parseChallenge } from '../src/base/x402.js';
import { payX402Base, type EvmSignatureRequester } from '../src/base/pay.js';
import { getBaseNetwork } from '../src/base/config.js';
import type { Grant } from '../src/core/types.js';

const URL_ = process.argv[2] ?? 'https://x402.org/protected';
const CHAIN = 84532;
const net = getBaseNetwork(CHAIN);
const FROM = '0x7De1259Cc50963091551B29DA22fDd01a0b8Ca79';

class Refused extends Error {}

async function main() {
  console.log(`\n▸ 1/2  price check — GET ${URL_} without paying\n`);
  const res = await fetch(URL_);
  if (res.status !== 402) {
    console.log(`  not payment-gated (HTTP ${res.status})`);
    return;
  }
  const challenge = await parseChallenge(res);
  for (const a of challenge.accepts ?? []) {
    const mine = a.network === net.caip2;
    console.log(
      `  ${mine ? '→' : ' '} ${a.network.padEnd(28)} ${a.amount.padStart(9)}  ${a.scheme}` +
        `  payTo ${a.payTo}${mine ? '' : '   (not our chain)'}`,
    );
  }

  const req = (challenge.accepts ?? []).find((a) => a.network === net.caip2);
  if (!req) {
    console.log(`\n  nothing offered on ${net.caip2} — nothing to sign`);
    return;
  }

  // A grant shaped to allow exactly this merchant and price, so the run gets all
  // the way to the signer instead of stopping at the checkpoint.
  const grant: Grant = {
    grantId: '0', campaignId: 'probe', repo: 'probe', spender: FROM,
    homeChain: 'near:testnet',
    asset: { id: net.usdc.address, symbol: 'USDC', decimals: 6 },
    spendableChains: [net.caip2],
    spendableAssets: [net.usdc.address],
    allowedPayees: [{ chain: net.caip2, address: req.payTo }],
    total: 1_000000n, released: 1_000000n, spent: 0n, spentToday: 0n,
    perTxCap: 1_000000n, dailyCap: 1_000000n,
    expiry: Math.floor(Date.now() / 1000) + 3600, revoked: false,
  };

  console.log(`\n▸ 2/2  wiring check — the SDK drives our signer, which then refuses\n`);
  const requester: EvmSignatureRequester = {
    async requestSignature(input) {
      console.log('  the contract would be asked for:');
      console.log(`    campaign     ${input.campaignId}`);
      console.log(`    to           ${input.to}`);
      console.log(`    amount       ${input.amount}  (${Number(input.amount) / 1e6} USDC)`);
      console.log(`    validBefore  ${input.validBefore}  (+${Number(input.validBefore) - Math.floor(Date.now() / 1000)}s)`);
      console.log(`    nonce        ${input.nonce}`);
      console.log(`    token        ${input.token.symbol} ${input.token.address}`);
      console.log(`    domain       {${input.token.eip712.name}, ${input.token.eip712.version}} chain ${input.chainId}`);
      throw new Refused('probe: refusing to sign — request_evm_signature lands in Wave 1 task 1.2');
    },
  };

  try {
    await payX402Base({ url: URL_, address: FROM as `0x${string}`, grant, callerMax: 1_000000n, requester, chainId: CHAIN });
    console.log('\n  ⚠️  it paid — that should be impossible with a refusing requester');
    process.exit(1);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const refused = msg.includes('probe: refusing to sign');
    console.log(`\n  ${refused ? '✓' : '✗'} signer reached and refused; nothing was paid`);
    if (!refused) { console.log(`    unexpected: ${msg}`); process.exit(1); }
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
