/**
 * Seed on-chain: nạp gas cho agent → tạo campaign → fund → phát Grant.
 *
 * Chạy: npx tsx scripts/seed.ts
 *
 * ⚠️ Demo dùng CHUNG một ví cho vai sponsor và vai agent, vì ta chỉ có XSGD
 * testnet ở một chỗ. Production thì tách hẳn hai ví.
 */

import { createWalletClient, createPublicClient, http, parseAbi, parseUnits, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji, avalanche } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { getNetwork, DEFAULT_CHAIN_ID } from '../src/config.js';

const net = getNetwork();
const chain = DEFAULT_CHAIN_ID === 43114 ? avalanche : avalancheFuji;
const dep = JSON.parse(readFileSync(`deployments/${net.chainId}.json`, 'utf8'));

const GM_ABI = parseAbi([
  'function createCampaign(bytes32 id, (address sponsor,bytes32 merchantId,uint256 funded,uint256 committed,uint256 grantAmount,uint32 trancheCount,uint32 tranchePeriod,uint256 minSpendPerTranche,uint32 minDaysPerTranche,uint64 grantValidity,uint256 perTxCap,uint256 dailyCap,address attestor,bool paused) c)',
  'function fund(bytes32 id, uint256 amount)',
  'function issueGrant(bytes32 campaignId, bytes32 projectId, address owner_, address signer_) returns (uint256)',
  'function grantOf(bytes32 projectId) view returns (uint256,bytes32,address,uint256,uint256,uint256,uint256,uint256,uint256,uint64,bool)',
  'function campaigns(bytes32) view returns (address,bytes32,uint256,uint256,uint256,uint32,uint32,uint256,uint32,uint64,uint256,uint256,address,bool)',
]);
const ERC20 = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
]);

const SGD = (n: string) => parseUnits(n, 6);
// 25 nAVAX là mức tối thiểu Avalanche chấp nhận; đặt cao hơn chỉ tổ đốt tiền.
const GAS = { gas: 250_000n, gasPrice: 25_000_000_000n };

/**
 * Một sponsor một campaign. Ví dụ:
 *   npx tsx scripts/seed.ts                         # SupaDB mặc định
 *   SPONSOR=neonlite npx tsx scripts/seed.ts        # campaign NeonLite
 *
 * Production: sponsor là ví riêng. Demo Fuji dùng cùng ví agent để nạp tiền;
 * logic contract vẫn ghi sponsor độc lập theo từng campaign.
 */
const SPONSOR = (process.env.SPONSOR ?? 'supadb').toLowerCase();
const SPONSOR_CONFIG: Record<string, { grantAmount: string; fundAmount: string }> = {
  supadb: { grantAmount: '2', fundAmount: '3' },
  neonlite: { grantAmount: '1', fundAmount: '2' },
  sentrywatch: { grantAmount: '1', fundAmount: '2' },
};
const sponsorConfig = SPONSOR_CONFIG[SPONSOR];
if (!sponsorConfig) throw new Error(`sponsor không hỗ trợ: ${SPONSOR}`);

const CAMPAIGN_ID = keccak256(toHex(`${SPONSOR}-launch-2026`));
const PROJECT_ID = keccak256(toHex(`demo-project-${SPONSOR}`));
const MERCHANT_ID = keccak256(toHex(SPONSOR));

async function key(account: 'agent-eoa' | 'relayer-eoa'): Promise<`0x${string}`> {
  const { Entry } = await import('@napi-rs/keyring');
  const pk = new Entry('sponsored-compute', account).getPassword();
  if (!pk) throw new Error(`không tìm thấy khoá ${account} trong keychain`);
  return pk as `0x${string}`;
}

async function main() {
  const pub = createPublicClient({ chain, transport: http(net.rpc) });
  const agent = privateKeyToAccount(await key('agent-eoa'));
  const relayer = privateKeyToAccount(await key('relayer-eoa'));
  const wAgent = createWalletClient({ account: agent, chain, transport: http(net.rpc) });
  const wRelayer = createWalletClient({ account: relayer, chain, transport: http(net.rpc) });

  // BẮT BUỘC kiểm status — waitForTransactionReceipt resolve cả khi tx revert,
  // nuốt lỗi làm script báo thành công giả.
  const wait = async (hash: `0x${string}`, label: string) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') {
      throw new Error(`${label} REVERT — ${net.explorer}/tx/${hash} (gas dùng ${r.gasUsed})`);
    }
    return r;
  };

  console.log(`chain ${net.name} · GrantManager ${dep.grantManager} · sponsor ${SPONSOR}`);
  console.log(`agent   ${agent.address}`);
  console.log(`relayer ${relayer.address}\n`);

  // ── 1. agent cần AVAX để gọi approve/fund/unwrap ───────────────────────────
  let gas = await pub.getBalance({ address: agent.address });
  if (gas < 15_000_000_000_000_000n) {
    console.log('① nạp gas cho agent…');
    const h = await wRelayer.sendTransaction({
      to: agent.address, value: 20_000_000_000_000_000n, ...GAS, gas: 21_000n,
    });
    await wait(h, "nạp gas");
    gas = await pub.getBalance({ address: agent.address });
  }
  console.log(`① agent có ${Number(gas) / 1e18} AVAX`);

  // ── 2. approve XSGD cho GrantManager ───────────────────────────────────────
  const allow = await pub.readContract({
    address: net.tokens.XSGD.address, abi: ERC20, functionName: 'allowance',
    args: [agent.address, dep.grantManager],
  });
  if ((allow as bigint) < SGD('5')) {
    console.log('② approve XSGD…');
    const h = await wAgent.writeContract({
      address: net.tokens.XSGD.address, abi: ERC20, functionName: 'approve',
      args: [dep.grantManager, SGD('1000')], ...GAS,
    });
    await wait(h, 'approve');
  }
  console.log('② allowance OK');

  // ── 3. tạo campaign ────────────────────────────────────────────────────────
  const c = (await pub.readContract({
    address: dep.grantManager, abi: GM_ABI, functionName: 'campaigns', args: [CAMPAIGN_ID],
  })) as readonly any[];

  if (c[0] === '0x0000000000000000000000000000000000000000') {
    console.log('③ tạo campaign…');
    const h = await wAgent.writeContract({
      address: dep.grantManager, abi: GM_ABI, functionName: 'createCampaign',
      args: [CAMPAIGN_ID, {
        sponsor: agent.address, merchantId: MERCHANT_ID,
        funded: 0n, committed: 0n,
        grantAmount: SGD(sponsorConfig.grantAmount),
        trancheCount: 4,                 // 4 tranche × 0.5
        tranchePeriod: 60,               // 60s cho demo
        minSpendPerTranche: SGD('0.3'),
        minDaysPerTranche: 0,
        grantValidity: 2592000n,         // 30 ngày
        perTxCap: SGD('0.5'),
        dailyCap: SGD('1'),
        attestor: '0x0000000000000000000000000000000000000000',
        paused: false,
      }], ...GAS, gas: 400_000n,
    });
    await wait(h, 'createCampaign');
  }
  console.log('③ campaign OK');

  // ── 4. nạp tiền vào campaign ───────────────────────────────────────────────
  const c2 = (await pub.readContract({
    address: dep.grantManager, abi: GM_ABI, functionName: 'campaigns', args: [CAMPAIGN_ID],
  })) as readonly any[];
  if ((c2[2] as bigint) < SGD(sponsorConfig.grantAmount)) {
    console.log(`④ fund campaign ${sponsorConfig.fundAmount} XSGD…`);
    const h = await wAgent.writeContract({
      address: dep.grantManager, abi: GM_ABI, functionName: 'fund',
      args: [CAMPAIGN_ID, SGD(sponsorConfig.fundAmount)], ...GAS,
    });
    await wait(h, 'fund');
  }
  console.log('④ campaign đã có tiền');

  // ── 5. phát Grant ──────────────────────────────────────────────────────────
  const g0 = (await pub.readContract({
    address: dep.grantManager, abi: GM_ABI, functionName: 'grantOf', args: [PROJECT_ID],
  })) as readonly any[];

  if ((g0[0] as bigint) === 0n) {
    console.log('⑤ phát Grant…');
    const h = await wAgent.writeContract({
      address: dep.grantManager, abi: GM_ABI, functionName: 'issueGrant',
      // ghi struct Grant tốn >250k gas — phải nâng hẳn lên
      args: [CAMPAIGN_ID, PROJECT_ID, agent.address, agent.address], ...GAS, gas: 600_000n,
    });
    await wait(h, 'issueGrant');
  }

  const g = (await pub.readContract({
    address: dep.grantManager, abi: GM_ABI, functionName: 'grantOf', args: [PROJECT_ID],
  })) as readonly any[];

  const f = (v: bigint) => (Number(v) / 1e6).toFixed(2);
  console.log(`\n✅ Grant #${g[0]}`);
  console.log(`   total ${f(g[3])} · đã vest ${f(g[4])} · đã tiêu ${f(g[5])} SGD`);
  console.log(`   trần ${f(g[7])}/giao dịch · ${f(g[8])}/ngày`);
  console.log(`\nthêm vào môi trường:\n  GRANT_MANAGER=${dep.grantManager}\n  PROJECT_ID=${PROJECT_ID}`);
}

main().catch((e) => {
  console.error('✗', e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
