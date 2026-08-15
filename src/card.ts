/**
 * Cầu nối StraitsX card — rail cho nền tảng KHÔNG nói x402.
 * Grant unwrap → thẻ Visa ảo dùng-một-lần đúng bằng số tiền hoá đơn.
 *
 * ⚠️ Endpoint này KHÔNG có trong docs.straitsx.com (grep llms.txt: 0 hit).
 * Toàn bộ hình dạng dưới đây lấy từ probe live 15/08/2026 — xem §4.2.
 */

import { getCardEnv, CARD_LIMITS, DEFAULT_CHAIN_ID } from './config.js';
import { payX402 } from './pay.js';
import type { Signer } from './signer.js';
import type { GrantView } from './checkpoint.js';

export interface CardRequest {
  amountSgd: number;
  cardholderName: string;
  signer: Signer;
  grant: GrantView | null;
  chainId?: number;
}

export interface CardResult {
  cardOpaqueId: string;
  cardHtml: string;
  settlementTx: string;
  paidAtomic: bigint;
  raw: any;
}

function validate(amountSgd: number, name: string) {
  const { minSgd, maxSgd, nameMin, nameMax } = CARD_LIMITS;
  if (!Number.isFinite(amountSgd) || amountSgd < minSgd || amountSgd > maxSgd) {
    throw new Error(`amount_sgd phải trong [${minSgd}, ${maxSgd}], nhận ${amountSgd}`);
  }
  if (name.length < nameMin || name.length > nameMax || !/^[A-Za-z ]+$/.test(name)) {
    throw new Error(`cardholder_name phải ${nameMin}-${nameMax} ký tự, chỉ chữ cái và khoảng trắng`);
  }
}

export async function issueCard(reqOpts: CardRequest): Promise<CardResult> {
  const chainId = reqOpts.chainId ?? DEFAULT_CHAIN_ID;
  validate(reqOpts.amountSgd, reqOpts.cardholderName);

  const { issueUrl } = getCardEnv(chainId);

  // trần người gọi = đúng số tiền thẻ (6 decimals). Không cho phép nhiều hơn.
  const maxAmount = BigInt(Math.round(reqOpts.amountSgd * 1_000_000));

  const res = await payX402({
    url: issueUrl,
    method: 'POST',
    body: { amount_sgd: reqOpts.amountSgd, cardholder_name: reqOpts.cardholderName },
    maxAmount,
    signer: reqOpts.signer,
    grant: reqOpts.grant,
    chainId,
  });

  if (res.status !== 200) {
    throw new Error(`issue_card thất bại (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 400)}`);
  }

  const b = res.body ?? {};
  return {
    cardOpaqueId: b.card_opaque_id ?? b.cardOpaqueId,
    cardHtml: b.card_html ?? b.cardHtml,
    settlementTx: b.settlement_tx ?? b.settlementTx,
    paidAtomic: res.paidAmount,
    raw: b,
  };
}

/**
 * Lấy lại URL iframe xem thẻ (một lần dùng). Quyền sở hữu verify bằng mật mã.
 * Gọi qua MCP `view_card_sandbox` — ở đây để tiện tham chiếu.
 */
export const VIEW_CARD_TOOL = 'view_card_sandbox';
