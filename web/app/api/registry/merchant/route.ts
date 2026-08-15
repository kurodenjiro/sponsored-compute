/**
 * Duyệt merchant TỰ ĐỘNG cho demo.
 *
 * 🔴 ĐÁNH ĐỔI, ĐỌC TRƯỚC KHI DÙNG THẬT (docs/SPONSORED-COMPUTE.md §9):
 * `MerchantRegistry.register` là `onlyOwner` vì allowlist là thứ chặn attacker
 * đăng ký chính ví mình làm merchant rồi `unwrap` Grant về đó. Route này ký hộ
 * bằng khoá chủ Registry, tức là BỎ khâu kiểm duyệt: repo nào gọi cũng được
 * duyệt, payTo nào cũng được nhận.
 *
 * Vì vậy nó chỉ tự bật trên testnet. Mainnet phải đặt tay
 * SPONSORED_AUTO_APPROVE_MERCHANTS=1 — để việc mở barrier là một quyết định
 * có chữ ký của con người, không phải mặc định im lặng.
 *
 * Khoá chỉ nằm ở server và chỉ ký đúng một hàm: register(merchantId, payTo, …).
 */

import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';
import { DEFAULT_CHAIN_ID, getNetwork } from '../../../../../src/config.js';
import { merchantIdOf, normalizeSponsor, parseRepoUrl, sponsorSlugOf } from '../../../../../src/campaign.js';

export const dynamic = 'force-dynamic';

const registryAbi = parseAbi([
  'function owner() view returns (address)',
  'function payToOf(bytes32 id) view returns (address)',
  'function register(bytes32 id, address payTo, string name, bytes32 category)',
]);
const grantAbi = parseAbi(['function registry() view returns (address)']);
const CATEGORY = keccak256(stringToHex('repo'));
const GAS = { gas: 200_000n, gasPrice: 25_000_000_000n };
const isAddress = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

function autoApproveAllowed(chainId: number) {
  if (process.env.SPONSORED_AUTO_APPROVE_MERCHANTS === '1') return true;
  if (process.env.SPONSORED_AUTO_APPROVE_MERCHANTS === '0') return false;
  return chainId !== 43114;
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  try {
    const repo = parseRepoUrl(String(body.repoUrl ?? ''));
    const sponsor = normalizeSponsor(String(body.sponsor ?? sponsorSlugOf(repo)));
    const merchantId = merchantIdOf(sponsor);
    const chainId = Number(body.chainId ?? DEFAULT_CHAIN_ID);
    const net = getNetwork(chainId);
    const chain = chainId === 43114 ? avalanche : avalancheFuji;
    const grantManager = (process.env.GRANT_MANAGER ?? net.grantManager) as `0x${string}` | undefined;
    if (!grantManager) return NextResponse.json({ error: `No GrantManager is deployed for chain ${chainId}.` }, { status: 400 });

    const publicClient = createPublicClient({ chain, transport: http(net.rpc) });
    const registry = await publicClient.readContract({ address: grantManager, abi: grantAbi, functionName: 'registry' });
    const existing = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'payToOf', args: [merchantId] });

    // Đã duyệt rồi thì không gửi giao dịch: register() sẽ revert AlreadyRegistered.
    if (existing !== '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({ ok: true, alreadyApproved: true, merchantId, sponsor, payTo: existing });
    }

    if (!autoApproveAllowed(chainId)) {
      return NextResponse.json(
        { error: 'Automatic merchant approval is disabled on this chain. The Registry owner must approve this merchant.', merchantId },
        { status: 403 },
      );
    }
    if (!isAddress(body.payTo)) return NextResponse.json({ error: 'payTo must be an address.' }, { status: 400 });

    const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) return NextResponse.json({ error: 'This deployment holds no Registry owner key, so it cannot approve merchants.' }, { status: 501 });
    const account = privateKeyToAccount(key);
    const owner = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'owner' });
    if (account.address.toLowerCase() !== owner.toLowerCase()) {
      return NextResponse.json({ error: `The server key ${account.address} does not own the Registry (${owner}).` }, { status: 501 });
    }

    const wallet = createWalletClient({ account, chain, transport: http(net.rpc) });
    const hash = await wallet.writeContract({
      address: registry, abi: registryAbi, functionName: 'register',
      args: [merchantId, body.payTo as `0x${string}`, sponsor, CATEGORY], ...GAS,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') return NextResponse.json({ error: 'register reverted', transaction: hash }, { status: 502 });

    return NextResponse.json({ ok: true, merchantId, sponsor, payTo: body.payTo, transaction: hash });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage ?? e?.message ?? String(e) }, { status: 400 });
  }
}
