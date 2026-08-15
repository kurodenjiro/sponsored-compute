/**
 * Gọi GrantManager.unwrap() — nhả ĐÚNG số tiền của lần chi này từ Grant sang
 * ví agent, ngay TRƯỚC khi ký EIP-3009.
 *
 * Đây là compliance guard on-chain, chạy song song với checkpoint phía client:
 *   - checkpoint (src/checkpoint.ts) chặn sớm, không tốn gas, ngoài context LLM
 *   - unwrap()   chặn ở tầng contract, không ai bỏ qua được kể cả khi client bị sửa
 *
 * Hai lớp cùng một luật. Client hỏng thì contract vẫn giữ.
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';
import { getNetwork, DEFAULT_CHAIN_ID } from './config.js';
import { agentPrivateKey } from './signer.js';

const GM_ABI = parseAbi([
  'function unwrap(uint256 grantId, address payTo, uint256 amount, bytes32 nonce)',
  'function claimGas(uint256 grantId, uint256 amount)',
  'function claimTranche(uint256 grantId)',
  // Custom error phải có trong ABI thì viem mới giải mã được tên lỗi; thiếu nó
  // thì mọi từ chối của contract đều hiện ra là "reverted" không lý do.
  'error NotOwnerOfGrant()',
  'error GrantRevokedErr()',
  'error GrantExpired()',
  'error MerchantNotAllowed()',
  'error OverPerTxCap()',
  'error OverDailyCap()',
  'error OverVested()',
  'error InvalidAsset()',
  'error ZeroAmount()',
  'error TrancheNotReady()',
  'error TrancheSpendTooLow()',
  'error TrancheDaysTooLow()',
  'error AllTranchesClaimed()',
]);

/** Đổi tên custom error của contract sang câu giải thích cho dev. */
const REVERT_HINTS: Record<string, string> = {
  OverPerTxCap: 'vượt trần mỗi giao dịch của Grant',
  OverDailyCap: 'vượt trần chi trong ngày',
  OverVested: 'vượt phần đã vest — chờ tranche kế tiếp',
  GrantExpired: 'Grant đã hết hạn',
  GrantRevokedErr: 'sponsor đã thu hồi Grant',
  MerchantNotAllowed: 'payTo không nằm trong allowlist',
  NotOwnerOfGrant: 'ví gọi không phải chủ Grant',
  InvalidAsset: 'sai loại tài sản của Grant',
  ZeroAmount: 'số tiền bằng 0',
  TrancheNotReady: 'chưa đủ thời gian để mở tranche kế tiếp',
  TrancheSpendTooLow: 'chưa tiêu đủ mức tối thiểu để mở tranche kế tiếp',
  TrancheDaysTooLow: 'chưa đủ số ngày tối thiểu cho tranche kế tiếp',
  AllTranchesClaimed: 'đã mở hết tranche',
};

/**
 * Gas tường minh khiến giao dịch vẫn được gửi dù chắc chắn revert — dev mất gas
 * và chỉ nhận "reverted". Simulate trước để biết lý do mà KHÔNG tốn gas.
 */
function revertReason(e: any): string | null {
  const name = e?.cause?.data?.errorName ?? e?.data?.errorName
    ?? e?.walk?.((x: any) => x?.data?.errorName)?.data?.errorName;
  if (!name) return null;
  return REVERT_HINTS[name] ? `${name} — ${REVERT_HINTS[name]}` : name;
}

/** Gas: ghi 3-4 slot + transfer ERC-20. 250k là dư. */
const GAS = { gas: 250_000n, gasPrice: 25_000_000_000n };

/**
 * Đi qua đúng nguồn khoá của signer.ts. Bản cũ đọc thẳng keychain, nên trên
 * máy không có OS keychain thì signer tạo ví trong file fallback và báo
 * "claimable", còn claim/pay/unwrap lại không thấy khoá và hỏng sạch — dù ví
 * đang tồn tại. Không tạo mới ở đây: tới bước ghi on-chain mà chưa có ví thì
 * đó là lỗi luồng, không phải lúc lặng lẽ sinh khoá.
 */
export async function agentKey(): Promise<`0x${string}`> {
  const found = await agentPrivateKey();
  if (!found) {
    throw new Error(
      'chưa có ví agent — chạy `sponsored-compute address` để tạo, hoặc đặt AGENT_PRIVATE_KEY',
    );
  }
  return found.pk;
}

export interface UnwrapResult {
  ok: boolean;
  transaction?: `0x${string}`;
  error?: string;
}

/**
 * @param nonce PHẢI là nonce sẽ dùng cho EIP-3009 — để dấu vết on-chain của
 *              unwrap và của settlement khớp nhau, đối soát được theo dự án.
 */
export async function unwrapFromGrant(opts: {
  grantManager: `0x${string}`;
  grantId: bigint;
  payTo: `0x${string}`;
  amount: bigint;
  nonce: `0x${string}`;
  chainId?: number;
}): Promise<UnwrapResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const net = getNetwork(chainId);
  const chain = chainId === 43114 ? avalanche : avalancheFuji;

  const account = privateKeyToAccount(await agentKey());
  const pub = createPublicClient({ chain, transport: http(net.rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });

  try {
    const hash = await wallet.writeContract({
      address: opts.grantManager,
      abi: GM_ABI,
      functionName: 'unwrap',
      args: [opts.grantId, opts.payTo, opts.amount, opts.nonce],
      ...GAS,
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') {
      return { ok: false, transaction: hash, error: 'unwrap revert — contract từ chối' };
    }
    return { ok: true, transaction: hash };
  } catch (e: any) {
    return { ok: false, error: e?.shortMessage ?? e?.message ?? String(e) };
  }
}

/**
 * Xin tranche kế tiếp sau khi usage đạt điều kiện campaign.
 * Không có oracle: GrantManager tự đọc `spent`, thời gian và số ngày đã dùng.
 */
export async function claimGrantTranche(opts: {
  grantManager: `0x${string}`;
  grantId: bigint;
  chainId?: number;
}): Promise<UnwrapResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const net = getNetwork(chainId);
  const chain = chainId === 43114 ? avalanche : avalancheFuji;
  const account = privateKeyToAccount(await agentKey());
  const pub = createPublicClient({ chain, transport: http(net.rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });

  const call = {
    address: opts.grantManager,
    abi: GM_ABI,
    functionName: 'claimTranche' as const,
    args: [opts.grantId] as const,
  };
  // Như claimGas: simulate trước để nói rõ thiếu điều kiện nào, không tốn gas.
  try {
    await pub.simulateContract({ ...call, account });
  } catch (e: any) {
    const r = revertReason(e);
    return { ok: false, error: r ? `claimTranche bị từ chối: ${r}` : (e?.shortMessage ?? e?.message ?? String(e)) };
  }
  try {
    const hash = await wallet.writeContract({ ...call, ...GAS });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') {
      return { ok: false, transaction: hash, error: 'claimTranche revert — usage hoặc thời gian chưa đủ' };
    }
    return { ok: true, transaction: hash };
  } catch (e: any) {
    const r = revertReason(e);
    return { ok: false, error: r ? `claimTranche bị từ chối: ${r}` : (e?.shortMessage ?? e?.message ?? String(e)) };
  }
}

/** Claim native AVAX from an AVAX campaign. Contract caps and vesting remain authoritative. */
export async function claimGasFromGrant(opts: {
  grantManager: `0x${string}`;
  grantId: bigint;
  amount: bigint;
  chainId?: number;
}): Promise<UnwrapResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const net = getNetwork(chainId);
  const chain = chainId === 43114 ? avalanche : avalancheFuji;
  const account = privateKeyToAccount(await agentKey());
  const pub = createPublicClient({ chain, transport: http(net.rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });
  const call = {
    address: opts.grantManager,
    abi: GM_ABI,
    functionName: 'claimGas' as const,
    args: [opts.grantId, opts.amount] as const,
  };
  try {
    // Simulate trước: contract từ chối thì báo đúng lý do và không tốn gas.
    await pub.simulateContract({ ...call, account });
  } catch (e: any) {
    const reason = revertReason(e);
    return { ok: false, error: reason ? `claimGas bị từ chối: ${reason}` : (e?.shortMessage ?? e?.message ?? String(e)) };
  }
  try {
    const hash = await wallet.writeContract({ ...call, ...GAS });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') return { ok: false, transaction: hash, error: 'claimGas reverted' };
    return { ok: true, transaction: hash };
  } catch (e: any) {
    const reason = revertReason(e);
    return { ok: false, error: reason ? `claimGas bị từ chối: ${reason}` : (e?.shortMessage ?? e?.message ?? String(e)) };
  }
}
