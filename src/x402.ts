/**
 * x402 client — parse challenge, ký EIP-3009, dựng header thanh toán.
 *
 * ⚠️ StraitsX dùng header PHI CHUẨN:
 *     response:  Payment-Required     (chuẩn x402 dùng: WWW-Authenticate / body)
 *     request:   PAYMENT-SIGNATURE    (chuẩn x402 dùng: X-PAYMENT)
 * Không có tài liệu nào — hình dạng dưới đây lấy từ probe live 15/08/2026.
 */

import { toHex } from 'viem';
import { randomBytes } from 'node:crypto';
import type { Signer } from './signer.js';

export interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  chainId: number;
  extra?: { assetTransferMethod?: string; name?: string; version?: string };
}

export interface Challenge {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirement[];
}

/** Đọc challenge từ response 402 — thử header trước, fallback sang body. */
export async function parseChallenge(res: Response): Promise<Challenge> {
  const raw =
    res.headers.get('payment-required') ??
    res.headers.get('www-authenticate') ??
    res.headers.get('x-payment-required');

  if (raw) {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      /* rơi xuống body */
    }
  }
  const body = await res.clone().json();
  if (!body?.accepts) throw new Error('402 nhưng không tìm thấy payment requirements');
  return body as Challenge;
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

export interface Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

/**
 * Ký EIP-3009 TransferWithAuthorization.
 *
 * QUAN TRỌNG: mọi giá trị lấy TỪ challenge, không tự tính client-side.
 * Domain name/version lấy từ `extra` — XSGD không expose version()/DOMAIN_SEPARATOR().
 */
export async function signPayment(
  signer: Signer,
  req: PaymentRequirement,
  opts: { nonce?: `0x${string}`; now?: number } = {},
): Promise<{ authorization: Authorization; signature: `0x${string}` }> {
  if (req.scheme !== 'exact') throw new Error(`scheme "${req.scheme}" chưa hỗ trợ (chỉ "exact")`);
  const method = req.extra?.assetTransferMethod ?? 'eip3009';
  if (method !== 'eip3009') {
    throw new Error(
      `assetTransferMethod "${method}" chưa hỗ trợ. Permit2 cần smart account — xem §2.`,
    );
  }

  const from = await signer.address();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? (toHex(randomBytes(32)) as `0x${string}`);

  const authorization: Authorization = {
    from,
    to: req.payTo,
    value: req.amount,
    validAfter: '0',
    validBefore: String(now + (req.maxTimeoutSeconds ?? 300)),
    nonce,
  };

  const signature = await signer.signTypedData({
    domain: {
      name: req.extra?.name ?? 'XSGD',
      version: req.extra?.version ?? '2',
      chainId: req.chainId,
      verifyingContract: req.asset,
    },
    types: EIP3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  } as any);

  return { authorization, signature };
}

/** Payload x402 v1 scheme "exact" / EVM. Hình dạng chưa có tài liệu — chỉnh ở đây nếu server từ chối. */
export function buildPaymentPayload(
  req: PaymentRequirement,
  authorization: Authorization,
  signature: `0x${string}`,
  x402Version = 1,
) {
  return {
    x402Version,
    scheme: req.scheme,
    network: req.network,
    payload: { signature, authorization },
  };
}

export function encodePaymentHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}
