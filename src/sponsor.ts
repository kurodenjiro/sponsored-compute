/**
 * Thao tác phía sponsor: tạo / nạp / tạm dừng campaign, thu hồi Grant, rút phần
 * chưa cam kết.
 *
 * Trước đây các việc này CHỈ làm được qua sponsor console bằng ví trình duyệt,
 * nên không script được và không test tự động được — muốn dựng một campaign để
 * kiểm thử là phải bấm tay. Module này mở đúng các hàm sponsor đã có trên
 * contract, không thêm quyền nào mới: mọi lệnh đều revert nếu người gọi không
 * phải sponsor của campaign.
 *
 * 🔴 Không hàm nào ở đây chi tiền của Grant. Đường tiêu tiền vẫn chỉ đi qua
 *    checkpoint trong pay.ts.
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';

import { DEFAULT_CHAIN_ID, getNetwork } from './config.js';
import { agentKey } from './unwrap.js';
import { capsFor, merchantIdOf } from './campaign.js';

/**
 * Ước lượng gas trên Fuji hay trả về "execution reverted" không rõ lý do cho
 * các hàm ghi struct lớn, nên đặt gas tường minh như claim.ts/unwrap.ts.
 */
const GAS = { gas: 600_000n, gasPrice: 25_000_000_000n };

const SPONSOR_ABI = parseAbi([
  'function createCampaign(bytes32 id, (address sponsor, bytes32 merchantId, uint256 funded, uint256 committed, uint256 grantAmount, uint32 trancheCount, uint32 tranchePeriod, uint256 minSpendPerTranche, uint32 minDaysPerTranche, uint64 grantValidity, uint256 perTxCap, uint256 dailyCap, address attestor, bool paused, uint8 asset) c)',
  'function fund(bytes32 id, uint256 amount)',
  'function fundAvax(bytes32 id) payable',
  'function withdrawUnused(bytes32 id)',
  'function revokeGrant(uint256 grantId)',
  'function setPaused(bytes32 id, bool p)',
  'function xsgd() view returns (address)',
  'error NotSponsor()',
  'error InvalidAsset()',
  'error WrongFundingMethod()',
  'error ZeroAmount()',
  'error GrantRevokedErr()',
]);

const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export interface SponsorResult {
  ok: boolean;
  transaction?: `0x${string}`;
  error?: string;
}

function clients(chainId: number) {
  const net = getNetwork(chainId);
  const chain = chainId === 43114 ? avalanche : avalancheFuji;
  return {
    net,
    chain,
    pub: createPublicClient({ chain, transport: http(net.rpc) }),
  };
}

async function wallet(chainId: number) {
  const { chain, net } = clients(chainId);
  const account = privateKeyToAccount(await agentKey());
  return { account, client: createWalletClient({ account, chain, transport: http(net.rpc) }) };
}

/** Lỗi custom của contract chỉ đọc được khi ABI có khai báo — xem unwrap.ts. */
function reason(e: any): string {
  const name = e?.cause?.data?.errorName ?? e?.data?.errorName;
  if (name === 'NotSponsor') return 'ví này không phải sponsor của campaign';
  if (name === 'WrongFundingMethod') return 'sai cách nạp: campaign XSGD dùng fund, campaign AVAX dùng fundAvax';
  if (name === 'InvalidAsset') return 'asset không hợp lệ (0 = XSGD, 1 = AVAX)';
  if (name === 'ZeroAmount') return 'số tiền bằng 0';
  if (name === 'GrantRevokedErr') return 'Grant đã bị thu hồi trước đó';
  return name ?? e?.shortMessage ?? e?.message ?? String(e);
}

export interface CreateCampaignOptions {
  grantManager: `0x${string}`;
  campaignId: `0x${string}`;
  /** Slug sponsor; merchantId suy ra từ đây, giống hệt sponsor console. */
  sponsor?: string;
  /** Ghi đè merchantId khi muốn trỏ vào merchant đã đăng ký sẵn. */
  merchantId?: `0x${string}`;
  /** Atomic: 6 decimals cho XSGD, 18 cho AVAX. */
  grantAmount: bigint;
  asset?: 0 | 1;
  trancheCount?: number;
  tranchePeriod?: number;
  grantValidityDays?: number;
  chainId?: number;
}

export async function createCampaign(opts: CreateCampaignOptions): Promise<SponsorResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const { pub } = clients(chainId);
  const { account, client } = await wallet(chainId);
  const asset = opts.asset ?? 0;
  const merchantId = opts.merchantId
    ?? (opts.sponsor ? merchantIdOf(opts.sponsor) : undefined);
  if (!merchantId) return { ok: false, error: 'thiếu --sponsor hoặc --merchant-id' };
  if (opts.grantAmount <= 0n) return { ok: false, error: 'grantAmount phải lớn hơn 0' };

  const caps = capsFor(opts.grantAmount);
  try {
    const transaction = await client.writeContract({
      ...GAS,
      address: opts.grantManager,
      abi: SPONSOR_ABI,
      functionName: 'createCampaign',
      args: [opts.campaignId, {
        sponsor: account.address,
        merchantId,
        funded: 0n,
        committed: 0n,
        grantAmount: opts.grantAmount,
        trancheCount: opts.trancheCount ?? 2,
        tranchePeriod: opts.tranchePeriod ?? 86_400,
        minSpendPerTranche: 0n,
        minDaysPerTranche: 0,
        grantValidity: BigInt((opts.grantValidityDays ?? 30) * 86_400),
        perTxCap: caps.perTxCap,
        dailyCap: caps.dailyCap,
        attestor: '0x0000000000000000000000000000000000000000',
        paused: false,
        asset,
      }],
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash: transaction });
    if (rcpt.status !== 'success') return { ok: false, transaction, error: 'createCampaign reverted' };
    return { ok: true, transaction };
  } catch (e: any) {
    return { ok: false, error: reason(e) };
  }
}

/** Nạp vốn. XSGD cần approve trước; AVAX gửi kèm value. */
export async function fundCampaign(opts: {
  grantManager: `0x${string}`;
  campaignId: `0x${string}`;
  amount: bigint;
  asset?: 0 | 1;
  chainId?: number;
}): Promise<SponsorResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const { pub } = clients(chainId);
  const { client } = await wallet(chainId);
  if (opts.amount <= 0n) return { ok: false, error: 'amount phải lớn hơn 0' };

  try {
    if ((opts.asset ?? 0) === 1) {
      const transaction = await client.writeContract({
        ...GAS, address: opts.grantManager, abi: SPONSOR_ABI,
        functionName: 'fundAvax', args: [opts.campaignId], value: opts.amount,
      });
      await pub.waitForTransactionReceipt({ hash: transaction });
      return { ok: true, transaction };
    }

    const xsgd = await pub.readContract({
      address: opts.grantManager, abi: SPONSOR_ABI, functionName: 'xsgd',
    }) as `0x${string}`;
    const approval = await client.writeContract({
      ...GAS, address: xsgd, abi: ERC20_ABI, functionName: 'approve',
      args: [opts.grantManager, opts.amount],
    });
    await pub.waitForTransactionReceipt({ hash: approval });

    const transaction = await client.writeContract({
      ...GAS, address: opts.grantManager, abi: SPONSOR_ABI,
      functionName: 'fund', args: [opts.campaignId, opts.amount],
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash: transaction });
    if (rcpt.status !== 'success') return { ok: false, transaction, error: 'fund reverted' };
    return { ok: true, transaction };
  } catch (e: any) {
    return { ok: false, error: reason(e) };
  }
}

/** Thu hồi Grant: phần chưa tiêu quay lại hạn mức chưa cam kết của campaign. */
export async function revokeGrant(opts: {
  grantManager: `0x${string}`;
  grantId: bigint;
  chainId?: number;
}): Promise<SponsorResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const { pub } = clients(chainId);
  const { client } = await wallet(chainId);
  try {
    const transaction = await client.writeContract({
      ...GAS, address: opts.grantManager, abi: SPONSOR_ABI,
      functionName: 'revokeGrant', args: [opts.grantId],
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash: transaction });
    if (rcpt.status !== 'success') return { ok: false, transaction, error: 'revokeGrant reverted' };
    return { ok: true, transaction };
  } catch (e: any) {
    return { ok: false, error: reason(e) };
  }
}

/** Rút phần vốn chưa cam kết cho bất kỳ Grant nào về ví sponsor. */
export async function withdrawUnused(opts: {
  grantManager: `0x${string}`;
  campaignId: `0x${string}`;
  chainId?: number;
}): Promise<SponsorResult> {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const { pub } = clients(chainId);
  const { client } = await wallet(chainId);
  try {
    const transaction = await client.writeContract({
      ...GAS, address: opts.grantManager, abi: SPONSOR_ABI,
      functionName: 'withdrawUnused', args: [opts.campaignId],
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash: transaction });
    if (rcpt.status !== 'success') return { ok: false, transaction, error: 'withdrawUnused reverted' };
    return { ok: true, transaction };
  } catch (e: any) {
    return { ok: false, error: reason(e) };
  }
}
