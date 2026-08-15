/**
 * Luồng thanh toán x402 hoàn chỉnh — dùng chung cho MỌI endpoint (card, platform, API).
 *
 * 🔴 Thứ tự BẤT BIẾN (docs/SPONSORED-COMPUTE.md §8.3):
 *   402 → CHECKPOINT → (unwrap) → ký → retry
 * Checkpoint LUÔN chạy trước khi ký. Không có nhánh nào bỏ qua nó.
 */

import { getNetwork, DEFAULT_CHAIN_ID } from './config.js';
import { parseChallenge, signPayment, buildPaymentPayload, encodePaymentHeader } from './x402.js';
import type { PaymentRequirement } from './x402.js';
import { checkpoint, explainDenial } from './checkpoint.js';
import { unwrapFromGrant } from './unwrap.js';
import { toHex } from 'viem';
import { randomBytes } from 'node:crypto';
import type { GrantView, Decision } from './checkpoint.js';
import type { Signer } from './signer.js';

export interface PayOptions {
  url: string;
  method?: string;
  body?: unknown;
  /** trần cứng do người gọi đặt — biên ngoài cùng, bắt buộc */
  maxAmount: bigint;
  signer: Signer;
  grant: GrantView | null;
  chainId?: number;
  /** bỏ qua checkpoint — CHỈ dùng trong unit test, không bao giờ ở runtime */
  __unsafeSkipCheckpoint?: boolean;
  /** Bật unwrap on-chain: nhả tiền từ Grant sang ví agent trước khi ký. */
  grantManager?: `0x${string}`;
  grantId?: bigint;
}

export interface PayResult {
  status: number;
  body: any;
  requirement: PaymentRequirement;
  authorization: unknown;
  paidAmount: bigint;
  settlementHeader?: string | null;
}

export class CheckpointDenied extends Error {
  constructor(public decision: Extract<Decision, { ok: false }>) {
    super(explainDenial(decision));
    this.name = 'CheckpointDenied';
  }
}

async function request(url: string, method: string, body: unknown, headers: Record<string, string>) {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function payX402(opts: PayOptions): Promise<PayResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const method = opts.method ?? 'POST';
  getNetwork(chainId); // ném sớm nếu chain không hỗ trợ

  // ① yêu cầu chưa trả tiền
  const first = await request(opts.url, method, opts.body, {});
  if (first.status !== 402) {
    return {
      status: first.status,
      body: await first.json().catch(() => null),
      requirement: undefined as any,
      authorization: null,
      paidAmount: 0n,
    };
  }

  // ② đọc challenge
  const challenge = await parseChallenge(first);
  const req = challenge.accepts?.[0];
  if (!req) throw new Error('402 nhưng accepts rỗng');

  // ③ 🔴 CHECKPOINT — trước khi ký, ngoài context LLM
  if (!opts.__unsafeSkipCheckpoint) {
    const decision = checkpoint({
      req, grant: opts.grant, callerMax: opts.maxAmount, chainId,
      signerAddress: await opts.signer.address(),
    });
    if (!decision.ok) throw new CheckpointDenied(decision);
  }

  // ④ unwrap on-chain — nhả ĐÚNG số tiền này từ Grant sang ví agent.
  //    nonce dùng chung với EIP-3009 để dấu vết unwrap ↔ settlement khớp nhau.
  const nonce = toHex(randomBytes(32)) as `0x${string}`;

  if (opts.grantManager && opts.grantId !== undefined) {
    const u = await unwrapFromGrant({
      grantManager: opts.grantManager,
      grantId: opts.grantId,
      payTo: req.payTo,
      amount: BigInt(req.amount),
      nonce,
      chainId,
    });
    if (!u.ok) throw new Error(`unwrap thất bại: ${u.error}`);
  }

  // ⑤ ký EIP-3009 — mọi giá trị lấy TỪ challenge, không tự tính
  const { authorization, signature } = await signPayment(opts.signer, req, { nonce });

  // ⑥ retry kèm PAYMENT-SIGNATURE
  const payload = buildPaymentPayload(req, authorization, signature, challenge.x402Version ?? 1);
  const header = encodePaymentHeader(payload);
  const second = await request(opts.url, method, opts.body, {
    'PAYMENT-SIGNATURE': header,
    'X-PAYMENT': header, // một số server dùng tên chuẩn — gửi cả hai vô hại
  });

  // đọc text MỘT LẦN rồi mới thử parse — gọi .json() hỏng xong .text() sẽ
  // ném "Body has already been read"
  const raw = await second.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { body = raw; }

  return {
    status: second.status,
    body,
    requirement: req,
    authorization,
    paidAmount: BigInt(req.amount),
    settlementHeader:
      second.headers.get('payment-response') ?? second.headers.get('x-payment-response'),
  };
}

/**
 * Shape của facilitator 0xGasless — KHÁC x402 chuẩn.
 * Nguồn: docs.0xgasless.com/x402/facilitator-api (đọc 15/08/2026).
 *   paymentPayload.token   ← BẮT BUỘC, địa chỉ token
 *   paymentPayload.payload.{authorization, signature}
 *   paymentRequirements    ← chỉ cần { chainId }
 *   validAfter/validBefore ← SỐ, không phải chuỗi
 */
function facilitatorBody(
  req: PaymentRequirement,
  authorization: any,
  signature: string,
  chainId: number,
) {
  return {
    paymentPayload: {
      token: req.asset,
      payload: {
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: String(authorization.value),
          validAfter: Number(authorization.validAfter),
          validBefore: Number(authorization.validBefore),
          nonce: authorization.nonce,
        },
        signature,
      },
    },
    paymentRequirements: { chainId },
  };
}

async function callFacilitator(
  path: '/verify' | '/settle',
  req: PaymentRequirement,
  authorization: unknown,
  signature: string,
  chainId: number,
) {
  const net = getNetwork(chainId);
  const res = await fetch(`${net.facilitator}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(facilitatorBody(req, authorization, signature, chainId)),
  });
  return { status: res.status, body: await res.json().catch(() => res.text()) };
}

/** Kiểm chữ ký mà KHÔNG settle — không tốn gas, KHÔNG đốt nonce. Chạy được khi ví chưa có token. */
export function verifyWithFacilitator(
  req: PaymentRequirement,
  authorization: unknown,
  signature: string,
  chainId = DEFAULT_CHAIN_ID,
) {
  return callFacilitator('/verify', req, authorization, signature, chainId);
}

/** Submit on-chain. Facilitator trả gas. ⚠️ TIÊU TIỀN THẬT trên mainnet. */
export function settleWithFacilitator(
  req: PaymentRequirement,
  authorization: unknown,
  signature: string,
  chainId = DEFAULT_CHAIN_ID,
) {
  return callFacilitator('/settle', req, authorization, signature, chainId);
}
