/**
 * x402 v2 client types for the Base leg.
 *
 * The shapes below are not guessed. They come from a live 402 captured on
 * 26/08/2026 from `https://x402.org/protected`:
 *
 *   {
 *     "x402Version": 2,
 *     "error": "Payment required",
 *     "resource": { "url": …, "description": …, "mimeType": "" },
 *     "accepts": [{
 *       "scheme": "exact",
 *       "network": "eip155:84532",        // CAIP-2 only — v2 dropped numeric chainId
 *       "amount": "10000",                 // v1 called this maxAmountRequired
 *       "asset": "0x036CbD53…",
 *       "payTo": "0x209693…",
 *       "maxTimeoutSeconds": 300,
 *       "extra": { "name": "USDC", "version": "2" }   // EIP-712 domain
 *     }]
 *   }
 *
 * Two things that changed since the Avalanche build:
 *   - `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` are the
 *     standard v2 headers. The old code used them while calling them
 *     "non-standard StraitsX headers" — that note was wrong, not the code.
 *   - There is no `extra.assetTransferMethod`. The scheme name carries it.
 */

import type { PaymentIntent } from '../core/types.js';
import { toCaip2, type EvmToken } from './config.js';

export interface PaymentRequirement {
  scheme: string;
  /** CAIP-2, e.g. `eip155:84532`. Legacy v1 names are normalised by `toCaip2`. */
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** EIP-712 domain of the token. USDC exposes no `version()`, so it rides here. */
  extra?: { name?: string; version?: string; [k: string]: unknown };
}

export interface Challenge {
  x402Version: number;
  error?: string;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: PaymentRequirement[];
}

export const PAYMENT_REQUIRED_HEADER = 'payment-required';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'payment-response';

/** Read the challenge: v2 header first, then body for servers still on v1. */
export async function parseChallenge(res: Response): Promise<Challenge> {
  const raw = res.headers.get(PAYMENT_REQUIRED_HEADER) ?? res.headers.get('x-payment-required');
  if (raw) {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      /* fall through to the body */
    }
  }
  const body = await res.clone().json();
  if (!body?.accepts) throw new Error('402 response carried no payment requirements');
  return body as Challenge;
}

/** Normalise a requirement into the neutral shape the policy layer decides on. */
export function toIntent(req: PaymentRequirement): PaymentIntent {
  return {
    chain: toCaip2(req.network),
    asset: req.asset,
    payTo: req.payTo,
    amount: req.amount,
    scheme: req.scheme,
    // EVM `exact` moves value with EIP-3009. v2 has no separate method field.
    transferMethod: 'eip3009',
  };
}

export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** The EIP-712 domain to sign under — from the challenge, checked against our registry. */
export function domainFor(req: PaymentRequirement, token: EvmToken, chainId: number) {
  const name = req.extra?.name ?? token.eip712.name;
  const version = req.extra?.version ?? token.eip712.version;
  if (name !== token.eip712.name || version !== token.eip712.version) {
    // A merchant that names a different domain than the token really uses is
    // either misconfigured or steering us into signing something else.
    throw new Error(
      `challenge declares EIP-712 domain {${name}, ${version}} but ${token.symbol} on ` +
        `chain ${chainId} uses {${token.eip712.name}, ${token.eip712.version}}`,
    );
  }
  return { name, version, chainId, verifyingContract: token.address } as const;
}

/**
 * There is deliberately no payload builder here any more.
 *
 * `@x402/evm`'s `ExactEvmScheme` owns the `PAYMENT-SIGNATURE` envelope, and the
 * wire format is theirs to version. What remains in this file is the read-only
 * half: parsing a challenge and turning it into an intent, which is what lets an
 * agent check a price **without paying** before deciding to call
 * `payX402Base()`.
 */
