#!/usr/bin/env -S npx tsx
/**
 * End-to-end proof that the contract signs correctly for Base.
 *
 * Asks `grant-manager` for a real EIP-3009 signature through the live MPC
 * signer, then rebuilds the same digest independently with `viem` and recovers
 * the signer address from the returned bytes. If that address equals the one
 * derived from `(grant-manager, campaign-<id>)`, then the digest construction
 * (task 1.1), the MPC call (1.2) and the signature assembly (1.3) are all
 * correct — and correct *together*, which is the part unit tests cannot show.
 *
 * Nothing settles: the authorisation is never submitted to Base. It does consume
 * grant budget, because issuing a signature is the spend.
 *
 * Usage: npm run base:sign -- <campaign> <repo>
 */

import { hashTypedData, recoverAddress, toHex } from 'viem';
import { randomBytes } from 'node:crypto';
import { deriveCampaignAddress } from '../src/base/address.js';
import { contractSignatureRequester } from '../src/near/evm-requester.js';
import { NearGrantSource } from '../src/near/grant.js';
import { getBaseNetwork } from '../src/base/config.js';

const [campaign, repo] = process.argv.slice(2);
if (!campaign || !repo) {
  console.error('usage: npm run base:sign -- <campaign> <repo>');
  process.exit(1);
}

const CHAIN = Number(process.env.BASE_CHAIN_ID ?? 84532);
const net = getBaseNetwork(CHAIN);

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

async function main() {
  const from = await deriveCampaignAddress(campaign);
  console.log(`\n▸ campaign "${campaign}" signs from ${from}`);

  const grant = await new NearGrantSource().byRepo(campaign, repo);
  if (!grant) throw new Error(`no grant for ${repo} under "${campaign}"`);
  const merchant = grant.allowedPayees.find((p) => p.chain === net.caip2)?.address;
  if (!merchant) throw new Error(`grant has no allowlisted merchant on ${net.caip2}`);

  const amount = 10_000n; // 0.01 USDC
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 120);
  const nonce = toHex(randomBytes(32)) as `0x${string}`;

  console.log(`▸ asking the contract to authorise ${amount} to ${merchant}`);
  const requester = await contractSignatureRequester();
  const signature = await requester.requestSignature({
    campaignId: campaign,
    to: merchant as `0x${string}`,
    amount,
    validAfter: 0n,
    validBefore,
    nonce,
    chainId: CHAIN,
    token: net.usdc,
  });
  console.log(`  signature ${signature}`);

  // Rebuilt here, not taken from the contract — the whole point is that two
  // independent implementations agree.
  const digest = hashTypedData({
    domain: {
      name: net.usdc.eip712.name,
      version: net.usdc.eip712.version,
      chainId: CHAIN,
      verifyingContract: net.usdc.address,
    },
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message: { from, to: merchant as `0x${string}`, value: amount, validAfter: 0n, validBefore, nonce },
  });
  const recovered = await recoverAddress({ hash: digest, signature });

  const ok = recovered.toLowerCase() === from.toLowerCase();
  console.log(`\n  digest    ${digest}`);
  console.log(`  recovered ${recovered}`);
  console.log(`  expected  ${from}`);
  console.log(`\n  ${ok ? '✓' : '✗'} ${ok ? 'the contract signs for the address it derives' : 'MISMATCH'}`);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
