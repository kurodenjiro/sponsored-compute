#!/usr/bin/env node
/**
 * CLI — dùng để dev/verify. KHÔNG phải bề mặt cho agent (agent dùng MCP).
 *
 *   npm run dev address              in địa chỉ ví agent
 *   npm run dev balance              số dư XSGD + AVAX
 *   npm run dev challenge [amount]   lấy 402 từ card API, in ra đã decode
 *   npm run dev verify  [amount]     ký EIP-3009 + POST /verify  ← KHÔNG cần token
 *   npm run dev card    [amount] [tên]   phát thẻ thật (TỐN TIỀN THẬT trên mainnet)
 *   npm run dev init --campaign 0x.. --sponsor supadb [--repo url] [--chain 43113]  kiểm campaign rồi ghi config
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
import { claimGrantTranche } from './unwrap.js';
import { runInit } from './init.js';
import { formatAmount, parseRepoUrl, sponsorSlugOf } from './campaign.js';
import { claimSponsoredGrant, readSponsorship } from './claim.js';

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

async function main() {
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
      const campaign = arg('campaign');
      const repo = arg('repo');
      const sponsor = arg('sponsor') ?? (repo ? sponsorSlugOf(parseRepoUrl(repo)) : 'unknown');
      if (!campaign) throw new Error('thiếu --campaign 0x…');
      const gm = (process.env.GRANT_MANAGER ?? net.grantManager) as `0x${string}` | undefined;
      if (!gm) throw new Error('thiếu GRANT_MANAGER cho network này; không thể xác minh campaign');
      const onChain = await getCampaign(gm, campaign as `0x${string}`, chainId);
      if (!onChain) throw new Error(`campaign không tồn tại trên ${net.name}: ${campaign}`);
      if (onChain.paused) throw new Error('campaign đang pause; không onboarding project mới');
      const files = runInit({ campaignId: campaign, sponsor, chainId, repo });
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
        const sgd = formatAmount;
        console.log(`  grant/dev : ${sgd(s.campaign.grantAmount)} XSGD`);
        console.log(`  còn lại   : ${sgd(s.campaign.funded - s.campaign.committed)} XSGD`);
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

    default:
      console.error(`Lệnh không rõ: ${cmd}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n${e?.name === 'CheckpointDenied' ? '' : '✗ '}${e?.message ?? e}`);
  process.exit(1);
});
