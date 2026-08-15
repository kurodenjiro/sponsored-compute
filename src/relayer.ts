/**
 * Self-relay — tự submit EIP-3009 lên chain, KHÔNG cần facilitator.
 *
 * Vì sao cần: facilitator công khai của 0xGasless khoá người nhận XSGD
 * (chỉ cho settle về ví StraitsX — xem §13.0). Nhưng `transferWithAuthorization`
 * là hàm PUBLIC trên chính contract XSGD: ai submit cũng được. Đó là bản chất
 * của EIP-3009 — người giữ token ký, người khác trả gas.
 *
 * Ta vẫn dùng /verify của 0xGasless để kiểm chữ ký (miễn phí, không chặn recipient).
 * Chỉ thay bước /settle.
 *
 * Chi phí: ~120.000 gas trên Avalanche ≈ vài cent mỗi lần settle.
 */

import { createWalletClient, createPublicClient, http, parseAbi, hexToSignature, isAddress, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';
import { getNetwork, DEFAULT_CHAIN_ID } from './config.js';
import type { PaymentRequirement, Authorization } from './x402.js';

const XSGD_ABI = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
]);

const SERVICE = 'sponsored-compute';
const ACCOUNT = 'relayer-eoa';

/** Ví relayer — TÁCH KHỎI ví agent. Chỉ giữ AVAX để trả gas, không giữ XSGD. */
async function relayerKey(): Promise<`0x${string}`> {
  if (process.env.RELAYER_PRIVATE_KEY) return process.env.RELAYER_PRIVATE_KEY as `0x${string}`;
  try {
    // webpackIgnore: native .node module — để Node require thẳng, bundler bỏ qua
    const { Entry } = await import(/* webpackIgnore: true */ '@napi-rs/keyring');
    const entry = new Entry(SERVICE, ACCOUNT);
    let pk: string | null = null;
    try { pk = entry.getPassword(); } catch { /* chưa có */ }
    if (!pk) {
      pk = generatePrivateKey();
      entry.setPassword(pk);
      console.error(`[relayer] ví relayer đã TẠO MỚI: ${privateKeyToAccount(pk as `0x${string}`).address}`);
      console.error('[relayer] ⚠️  nạp một ít AVAX vào ví này để trả gas settle');
    }
    return pk as `0x${string}`;
  } catch {
    throw new Error('Không có keychain và không có RELAYER_PRIVATE_KEY');
  }
}

function viemChain(chainId: number) {
  return chainId === 43114 ? avalanche : avalancheFuji;
}

export interface SettleResult {
  success: boolean;
  transaction?: `0x${string}`;
  blockNumber?: bigint;
  payer: `0x${string}`;
  error?: string;
}

/**
 * Một chữ ký EIP-3009 chỉ có ý nghĩa cho đúng hoá đơn mà merchant vừa phát.
 *
 * Không được chỉ kiểm tra chữ ký: một authorization hợp lệ cho recipient/amount
 * khác có thể bị gửi vào endpoint này. Lớp này bind payload vào challenge trước
 * khi claim nonce hoặc broadcast transaction.
 */
export function validateAuthorizationBinding(
  req: PaymentRequirement,
  auth: Authorization,
  now = Math.floor(Date.now() / 1000),
): string | null {
  if (!isAddress(auth.from)) return 'authorization.from không phải địa chỉ EVM hợp lệ';
  if (!isAddress(auth.to) || auth.to.toLowerCase() !== req.payTo.toLowerCase()) {
    return 'authorization.to không khớp merchant payTo trong payment requirement';
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) return 'authorization.nonce không phải bytes32 hợp lệ';

  let value: bigint;
  let validAfter: bigint;
  let validBefore: bigint;
  try {
    value = BigInt(auth.value);
    validAfter = BigInt(auth.validAfter);
    validBefore = BigInt(auth.validBefore);
  } catch {
    return 'authorization chứa value hoặc thời gian không hợp lệ';
  }

  if (value !== BigInt(req.amount)) return 'authorization.value không khớp giá của merchant';
  const nowSeconds = BigInt(now);
  if (validAfter > nowSeconds || validBefore <= nowSeconds) {
    return 'authorization chưa hiệu lực hoặc đã hết hạn';
  }
  // Chỉ nhận một chữ ký có lifetime xấp xỉ timeout merchant công bố. 30 giây
  // tolerance dành cho độ trễ giữa lúc client ký và lúc merchant xử lý.
  if (validBefore > nowSeconds + BigInt(req.maxTimeoutSeconds + 30)) {
    return 'authorization có thời hạn dài hơn payment requirement cho phép';
  }
  return null;
}

/**
 * Submit transferWithAuthorization trực tiếp lên XSGD.
 * Recipient là bất kỳ ai — không có allowlist ở tầng contract.
 */
export async function settleDirect(
  req: PaymentRequirement,
  auth: Authorization,
  signature: `0x${string}`,
  chainId = DEFAULT_CHAIN_ID,
): Promise<SettleResult> {
  const net = getNetwork(chainId);
  const bound = validateAuthorizationBinding(req, auth);
  if (bound) return { success: false, payer: auth.from, error: bound };
  const chain = viemChain(chainId);
  const pk = await relayerKey();
  const account = privateKeyToAccount(pk);

  const pub = createPublicClient({ chain, transport: http(net.rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });

  // ① verify chữ ký TẠI CHỖ — không gọi /verify của 0xGasless, vì endpoint đó
  //    cũng áp recipient allowlist (chỉ cho payTo = ví StraitsX). Ta tự làm,
  //    không phụ thuộc bên thứ ba nào.
  const token = net.tokens.XSGD;
  const recovered = await recoverTypedDataAddress({
    domain: {
      name: req.extra?.name ?? token.eip712.name,
      version: req.extra?.version ?? token.eip712.version,
      chainId, verifyingContract: req.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from, to: auth.to, value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    signature,
  });
  if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
    return { success: false, payer: auth.from, error: `Chữ ký không khớp: recover ra ${recovered}` };
  }

  // ② nonce đã dùng chưa — tránh tốn gas cho tx chắc chắn revert
  const used = await pub.readContract({
    address: req.asset, abi: XSGD_ABI,
    functionName: 'authorizationState',
    args: [auth.from, auth.nonce],
  });
  if (used) {
    return { success: false, payer: auth.from, error: 'Nonce đã được dùng (replay hoặc đã settle)' };
  }

  const { v, r, s } = hexToSignature(signature);
  const args = [
    auth.from, auth.to, BigInt(auth.value),
    BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce,
    Number(v), r, s,
  ] as const;

  try {
    /**
     * Dùng LEGACY gasPrice, KHÔNG dùng EIP-1559.
     *
     * Verified 15/08/2026: RPC công khai của Avalanche từ chối tx type-2 với
     * "Missing or invalid parameters" (Fuji báo baseFeePerGas = 10 wei, viem
     * ước lượng maxFee 162 wei → RPC không nhận). Legacy gasPrice chạy ngay:
     * tx 0x8828a985…c535, block 57770430.
     */
    const gasPrice = await pub.getGasPrice().catch(() => 0n);
    const price = gasPrice > 25_000_000_000n ? gasPrice : 30_000_000_000n; // sàn 30 nAVAX

    /**
     * Gas limit CỐ ĐỊNH — không dùng estimateContractGas.
     * Verified: RPC công khai của Avalanche trả về giá trị rác (~1.99e15) cho
     * hàm này, khiến tx bị RPC từ chối. transferWithAuthorization thực tế tốn
     * ~120k gas (con số này khớp docs 0xGasless), nên 200k là dư an toàn.
     */
    const hash = await wallet.writeContract({
      address: req.asset,
      abi: XSGD_ABI,
      functionName: 'transferWithAuthorization',
      args: args as any,
      gas: 200_000n,
      gasPrice: price,
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    return {
      success: rcpt.status === 'success',
      transaction: hash,
      blockNumber: rcpt.blockNumber,
      payer: auth.from,
      error: rcpt.status === 'success' ? undefined : 'tx revert',
    };
  } catch (e: any) {
    return { success: false, payer: auth.from, error: e?.shortMessage ?? e?.message ?? String(e) };
  }
}

export async function relayerAddress(): Promise<`0x${string}`> {
  return privateKeyToAccount(await relayerKey()).address;
}
