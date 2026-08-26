#!/usr/bin/env -S npx tsx
/**
 * Task 0.7 — test vectors for the EIP-712 digest.
 *
 * This is the hand-off between the two workers (docs/TASKS-NEAR.md §2.3): viem
 * produces the digest here, and the Rust test in `contract-near` has to arrive
 * at the same 32 bytes from `env::keccak256`. Neither side reads the other's
 * code; they agree on this file.
 *
 * The cases are chosen to catch the mistakes that actually happen:
 *   - Base mainnet and Sepolia, because their EIP-712 `name` differs
 *     ("USD Coin" vs "USDC") and hardcoding one silently breaks the other
 *   - a large `value`, to catch uint256 encoding that only works for small ints
 *   - `validAfter: 0`, the leading-zero case
 *
 * Run: npx tsx scripts/gen-eip712-fixtures.ts
 */

import { writeFileSync } from 'node:fs';
import { hashTypedData, hashDomain, keccak256, toHex } from 'viem';
import { BASE_NETWORKS } from '../src/base/config.js';

const FROM = '0x7De1259Cc50963091551B29DA22fDd01a0b8Ca79' as const;
const TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C' as const;

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

const amounts: [string, string][] = [
  ['small', '10000'],
  ['large', '115792089237316195423570985008687907853269984665640564039457584007913129639935'],
];

const cases = Object.values(BASE_NETWORKS).flatMap((net) =>
  amounts.map(([label, value]) => {
    const message = {
      from: FROM,
      to: TO,
      value: BigInt(value),
      validAfter: 0n,
      validBefore: 1_800_000_300n,
      nonce: `0x${'11'.repeat(32)}` as `0x${string}`,
    };
    const domain = {
      name: net.usdc.eip712.name,
      version: net.usdc.eip712.version,
      chainId: net.chainId,
      verifyingContract: net.usdc.address,
    } as const;
    return {
      label: `${net.name}-${label}`,
      chainId: net.chainId,
      verifyingContract: net.usdc.address,
      domainName: net.usdc.eip712.name,
      domainVersion: net.usdc.eip712.version,
      from: message.from,
      to: message.to,
      value,
      validAfter: '0',
      validBefore: '1800000300',
      nonce: message.nonce,
      // The intermediates are here so a Rust failure says *which* step drifted.
      // A bare digest mismatch tells you nothing about where to look.
      domainSeparator: hashDomain({
        domain: { ...domain, chainId: BigInt(domain.chainId) },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
        },
      }),
      digest: hashTypedData({ domain, types: TYPES, primaryType: 'TransferWithAuthorization', message }),
    };
  }),
);

const typeHashes = {
  eip712Domain: keccak256(toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
  transferWithAuthorization: keccak256(
    toHex('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'),
  ),
};

const out = 'contract-near/tests/fixtures/eip712.json';
writeFileSync(out, JSON.stringify({ typeHashes, cases }, null, 2) + '\n');
console.log(`${cases.length} vectors + 2 type hashes → ${out}`);
for (const c of cases) console.log(`  ${c.label.padEnd(22)} ${c.domainName.padEnd(9)} ${c.digest}`);
