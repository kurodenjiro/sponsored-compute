#!/usr/bin/env node
/**
 * CLI — dùng để dev/verify. KHÔNG phải bề mặt cho agent (agent dùng MCP).
 *
 *   npm run dev address              in địa chỉ ví agent
 *   npm run dev balance              số dư XSGD + AVAX
 *   npm run dev challenge [amount]   lấy 402 từ card API, in ra đã decode
 *   npm run dev verify  [amount]     ký EIP-3009 + POST /verify  ← KHÔNG cần token
 *   npm run dev card    [amount] [tên]   phát thẻ thật (TỐN TIỀN THẬT trên mainnet)
 *   npm run dev init [claude|codex] --campaign 0x.. --sponsor supadb [--repo url] [--chain 43113]
 *     kiểm campaign rồi ghi config; bỏ --campaign → cài đặt chung, chỉ nối MCP server
 *     client đứng ngay sau "init"; bỏ trống ghi cho cả Claude Code và Codex CLI
 *   npm run dev sponsorship [--wallet 0x..]   dự án này có tài trợ không (read-only)
 *   npm run dev claim-grant [--campaign 0x..] [--wallet 0x..]  phát Grant cho ví này
 *   npm run dev claim --grant-manager 0x.. --project 0x..  xin tranche kế tiếp
 */

import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { getSigner } from './signer.js';
import { getNetwork, getCardEnv, DEFAULT_CHAIN_ID, isMainnet } from './config.js';
import { parseChallenge, signPayment } from './x402.js';
import { verifyWithFacilitator } from './pay.js';
import { issueCard } from './card.js';
import { getCampaign, getGrantSource } from './grant.js';
import { claimGasFromGrant, claimGrantTranche } from './unwrap.js';
import { runInit } from './init.js';
import { formatAmount, parseRepoUrl, sponsorSlugOf } from './campaign.js';
import { claimSponsoredGrant, readSponsorship } from './claim.js';
import { createCampaign, fundCampaign, revokeGrant, withdrawUnused } from './sponsor.js';

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const cmd = process.argv[2] ?? 'address';
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const chainId = Number(arg('chain') ?? DEFAULT_CHAIN_ID);
const net = getNetwork(chainId);

function banner() {
  const tag = isMainnet(chainId) ? '🔴 MAINNET — TIỀN THẬT' : '🟢 testnet';
  console.log(`[${net.name} / ${net.chainId}] ${tag}`);
}

async function fetchChallenge(amountSgd: number) {
  const { issueUrl } = getCardEnv(chainId);
  const res = await fetch(issueUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount_sgd: amountSgd, cardholder_name: 'Test Dev' }),
  });
  if (res.status !== 402) throw new Error(`mong đợi 402, nhận ${res.status}`);
  const ch = await parseChallenge(res);
  return ch.accepts[0];
}

const requireGrantManager = (): `0x${string}` => {
  const gm = (arg('grant-manager') ?? process.env.GRANT_MANAGER ?? getNetwork(chainId).grantManager) as `0x${string}` | undefined;
  if (!gm) throw new Error('thiếu --grant-manager hoặc GRANT_MANAGER');
  return gm;
};

const requireBytes32 = (v: string | undefined, flag: string): `0x${string}` => {
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${flag} phải là bytes32`);
  return v as `0x${string}`;
};

/** Nhận atomic units. Sai đơn vị ở đây là sai số tiền, nên chặn thẳng. */
const requireAmount = (v: string | undefined, flag: string): bigint => {
  if (!v || !/^\d+$/.test(v)) throw new Error(`${flag} phải là số nguyên atomic units`);
  const amount = BigInt(v);
  if (amount <= 0n) throw new Error(`${flag} phải lớn hơn 0`);
  return amount;
};

const USAGE = `
Cách dùng: sponsored-compute <lệnh> [tuỳ chọn]

  address                            in địa chỉ ví agent
  balance                            số dư XSGD và AVAX
  challenge [sgd]                    lấy một challenge x402 từ merchant
  verify [sgd]                       ký thử EIP-3009 rồi verify qua facilitator
  card [sgd] [tên]                   phát thẻ demo qua đường x402
  init <claude|codex>                ghi cấu hình MCP cho agent vào thư mục này
  sponsorship                        đọc sponsored.json và đối chiếu on-chain
  claim-grant --campaign <id> [--wallet <addr>]
                                     claim Grant cho ví (tốn gas)
  claim --grant-manager <addr> --project <id>
                                     mở tranche vesting kế tiếp
  claim-gas --grant-manager <addr> --project <id> --amount <atomic>
                                     nhả AVAX gas từ Grant (18 decimals)

Lệnh sponsor (ví gọi phải là sponsor của campaign):
  create-campaign --campaign <id> --grant-amount <atomic>
                  [--sponsor <slug> | --merchant-id <bytes32>]
                  [--asset xsgd|avax] [--validity-days 30]
  fund-campaign --campaign <id> --amount <atomic> [--asset xsgd|avax]
  revoke-grant --grant-id <n>        thu phần chưa tiêu về campaign
  withdraw-unused --campaign <id>    rút phần chưa cam kết về ví sponsor

Biến môi trường: CHAIN_ID, GRANT_MANAGER, PROJECT_ID, SPONSORED_REGISTRY_URL
`.trimStart();

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    return;
  }

  banner();
  const signer = await getSigner();
  const addr = await signer.address();

  switch (cmd) {
    case 'address':
      console.log(addr);
      break;

    case 'balance': {
      const client = createPublicClient({ transport: http(net.rpc) });
      const xsgd = net.tokens.XSGD;
      const [bal, gas] = await Promise.all([
        client.readContract({ address: xsgd.address, abi: ERC20, functionName: 'balanceOf', args: [addr] }),
        client.getBalance({ address: addr }),
      ]);
      console.log(`XSGD : ${formatUnits(bal as bigint, xsgd.decimals)}`);
      console.log(`AVAX : ${formatUnits(gas, 18)}   (cần cho unwrap/claimTranche)`);
      break;
    }

    case 'challenge': {
      const req = await fetchChallenge(Number(process.argv[3] ?? 5));
      console.log(JSON.stringify(req, null, 2));
      break;
    }

    case 'verify': {
      // Chạy được NGAY cả khi ví chưa có XSGD — /verify chỉ kiểm chữ ký.
      const req = await fetchChallenge(Number(process.argv[3] ?? 5));
      const { authorization, signature } = await signPayment(signer, req);
      console.log('authorization:', JSON.stringify(authorization, null, 2));
      console.log('signature    :', signature);
      const out = await verifyWithFacilitator(req, authorization, signature, chainId);
      console.log(`\nfacilitator ${net.facilitator}/verify → HTTP ${out.status}`);
      console.log(JSON.stringify(out.body, null, 2));
      break;
    }

    case 'card': {
      const amount = Number(process.argv[3] ?? 5);
      const name = process.argv[4] ?? 'Test Dev';
      if (isMainnet(chainId)) console.log(`⚠️  Sắp tiêu ${amount} XSGD THẬT.`);
      const grant = await getGrantSource().get(process.env.PROJECT_ID ?? '0x');
      if (!grant) console.log('⚠️  Không có Grant → checkpoint sẽ TỪ CHỐI (đúng như thiết kế).');
      const card = await issueCard({ amountSgd: amount, cardholderName: name, signer, grant, chainId });
      console.log('card_opaque_id:', card.cardOpaqueId);
      console.log('settlement_tx :', `${net.explorer}/tx/${card.settlementTx}`);
      console.log('card_html     :', card.cardHtml);
      break;
    }

    case 'init': {
      const clientArg = process.argv[3];
      const client = clientArg === 'claude' || clientArg === 'codex' ? clientArg : undefined;
      const campaign = arg('campaign');
      const repo = arg('repo');
      const sponsor = arg('sponsor') ?? (repo ? sponsorSlugOf(parseRepoUrl(repo)) : undefined);

      if (!campaign) {
        // Cài đặt chung: chưa gắn campaign nào, chỉ nối MCP server cho agent.
        const files = runInit({ sponsor, chainId, repo, client });
        console.log(`đã ghi: ${files.join(', ')}`);
        console.log(`\nMở ${client === 'codex' ? 'Codex CLI' : client === 'claude' ? 'Claude Code' : 'Claude Code hoặc Codex CLI'} trong thư mục này — MCP server tự nạp.`);
        break;
      }

      const gm = (process.env.GRANT_MANAGER ?? net.grantManager) as `0x${string}` | undefined;
      if (!gm) throw new Error('thiếu GRANT_MANAGER cho network này; không thể xác minh campaign');
      const onChain = await getCampaign(gm, campaign as `0x${string}`, chainId);
      if (!onChain) throw new Error(`campaign không tồn tại trên ${net.name}: ${campaign}`);
      if (onChain.paused) throw new Error('campaign đang pause; không onboarding project mới');
      const files = runInit({ campaignId: campaign, sponsor: sponsor ?? 'unknown', chainId, repo, client });
      console.log(`đã ghi: ${files.join(', ')}`);
      console.log(`campaign verified: sponsor ${onChain.sponsor} · grant ${formatAmount(onChain.grantAmount)} XSGD`);
      console.log('\nMở Claude Code trong thư mục này rồi hỏi:');
      console.log('  "dự án này có tài trợ không?"');
      break;
    }

    case 'sponsorship': {
      const wallet = arg('wallet') ?? addr;
      const found = await readSponsorship({ wallet });
      if (found.length === 0) {
        console.log('không có sponsored.json ở thư mục này — dự án không mang con trỏ tài trợ nào');
        break;
      }
      for (const s of found) {
        console.log(`\n${s.pointer.repo ?? s.pointer.campaignId}  (sponsor ${s.pointer.sponsor}, chain ${s.pointer.chainId})`);
        if (!s.campaign) { console.log(`  ✗ ${s.reason}`); continue; }
        const symbol = s.campaign.asset === 1 ? 'AVAX' : 'XSGD';
        const decimals = s.campaign.asset === 1 ? 18 : 6;
        const amount = (value: bigint) => formatAmount(value, decimals);
        console.log(`  loại      : ${s.campaign.asset === 1 ? 'native AVAX gas grant' : 'XSGD x402 payment grant'}`);
        console.log(`  grant/dev : ${amount(s.campaign.grantAmount)} ${symbol}`);
        console.log(`  còn lại   : ${amount(s.campaign.funded - s.campaign.committed)} ${symbol}`);
        console.log(`  ${s.grantId ? `✓ ${wallet} đã có Grant ${s.grantId}` : s.claimable ? `→ claim được cho ${wallet}` : `✗ ${s.reason}`}`);
      }
      break;
    }

    case 'claim-grant': {
      const out = await claimSponsoredGrant({ campaignId: arg('campaign'), rewardWallet: arg('wallet'), chainId });
      if (!out.ok) throw new Error(out.error);
      console.log(out.alreadyClaimed
        ? `ví này đã có Grant ${out.grantId} — không phát thêm, không tốn gas`
        : `✓ Grant ${out.grantId}: ${net.explorer}/tx/${out.transaction}`);
      console.log(`projectId: ${out.projectId}  (đã ghi vào sponsored.json)`);
      if (!out.registered) console.log(`⚠️  registry chưa ghi nhận: ${out.registryError} — Grant on-chain vẫn hợp lệ`);
      break;
    }

    case 'claim': {
      const grantManager = (arg('grant-manager') ?? process.env.GRANT_MANAGER) as `0x${string}` | undefined;
      const project = arg('project') ?? process.env.PROJECT_ID;
      if (!grantManager) throw new Error('thiếu --grant-manager hoặc GRANT_MANAGER');
      if (!project) throw new Error('thiếu --project hoặc PROJECT_ID');
      const grant = await getGrantSource().get(project);
      if (!grant) throw new Error('không tìm thấy Grant cho project này');
      const out = await claimGrantTranche({ grantManager, grantId: BigInt(grant.grantId), chainId });
      if (!out.ok) throw new Error(out.error);
      console.log(`✓ tranche đã mở: ${net.explorer}/tx/${out.transaction}`);
      break;
    }

    case 'claim-gas': {
      const grantManager = (arg('grant-manager') ?? process.env.GRANT_MANAGER) as `0x${string}` | undefined;
      const project = arg('project') ?? process.env.PROJECT_ID;
      const amount = arg('amount');
      if (!grantManager) throw new Error('thiếu --grant-manager hoặc GRANT_MANAGER');
      if (!project) throw new Error('thiếu --project hoặc PROJECT_ID');
      if (!amount) throw new Error('thiếu --amount (atomic AVAX, 18 decimals)');
      const grant = await getGrantSource().get(project);
      if (!grant) throw new Error('không tìm thấy Grant cho project này');
      if (grant.asset !== 1) throw new Error('Grant này là XSGD, không phải AVAX gas grant');
      const out = await claimGasFromGrant({ grantManager, grantId: BigInt(grant.grantId), amount: BigInt(amount), chainId });
      if (!out.ok) throw new Error(out.error);
      console.log(`✓ AVAX gas đã nhả: ${net.explorer}/tx/${out.transaction}`);
      break;
    }

    /**
     * Các lệnh sponsor. Trước đây chỉ bấm được trên console bằng ví trình
     * duyệt, nên không dựng được campaign để test tự động.
     */
    case 'create-campaign': {
      const grantManager = requireGrantManager();
      const campaignId = requireBytes32(arg('campaign'), '--campaign');
      const asset = arg('asset') === 'avax' ? 1 : 0;
      const grantAmount = requireAmount(arg('grant-amount'), '--grant-amount');
      const out = await createCampaign({
        grantManager, campaignId, chainId, asset,
        sponsor: arg('sponsor'),
        merchantId: arg('merchant-id') as `0x${string}` | undefined,
        grantAmount,
        ...(arg('validity-days') ? { grantValidityDays: Number(arg('validity-days')) } : {}),
      });
      if (!out.ok) throw new Error(out.error);
      console.log(`✓ campaign đã tạo: ${net.explorer}/tx/${out.transaction}`);
      console.log(`  campaignId: ${campaignId}  ·  asset: ${asset === 1 ? 'AVAX' : 'XSGD'}`);
      console.log('  Nạp vốn bằng: sponsored-compute fund-campaign --campaign <id> --amount <atomic>');
      break;
    }

    case 'fund-campaign': {
      const grantManager = requireGrantManager();
      const campaignId = requireBytes32(arg('campaign'), '--campaign');
      const amount = requireAmount(arg('amount'), '--amount');
      const asset = arg('asset') === 'avax' ? 1 : 0;
      if (isMainnet(chainId)) console.log(`⚠️  Sắp nạp ${amount} đơn vị atomic TIỀN THẬT.`);
      const out = await fundCampaign({ grantManager, campaignId, amount, asset, chainId });
      if (!out.ok) throw new Error(out.error);
      console.log(`✓ đã nạp campaign: ${net.explorer}/tx/${out.transaction}`);
      break;
    }

    case 'revoke-grant': {
      const grantManager = requireGrantManager();
      const grantId = arg('grant-id');
      if (!grantId) throw new Error('thiếu --grant-id');
      const out = await revokeGrant({ grantManager, grantId: BigInt(grantId), chainId });
      if (!out.ok) throw new Error(out.error);
      console.log(`✓ Grant ${grantId} đã thu hồi: ${net.explorer}/tx/${out.transaction}`);
      console.log('  Phần chưa tiêu đã quay lại campaign; rút về bằng withdraw-unused.');
      break;
    }

    case 'withdraw-unused': {
      const grantManager = requireGrantManager();
      const campaignId = requireBytes32(arg('campaign'), '--campaign');
      const out = await withdrawUnused({ grantManager, campaignId, chainId });
      if (!out.ok) throw new Error(out.error);
      console.log(`✓ đã rút phần chưa cam kết: ${net.explorer}/tx/${out.transaction}`);
      break;
    }

    default:
      console.error(`Lệnh không rõ: ${cmd}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n${e?.name === 'CheckpointDenied' ? '' : '✗ '}${e?.message ?? e}`);
  process.exit(1);
});
