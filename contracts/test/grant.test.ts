/**
 * Test GrantManager — các cảnh CHẶN on-chain (đối ứng với checkpoint phía client).
 * Chạy: npx hardhat test
 */

import { expect } from 'chai';
import hre from 'hardhat';
import { keccak256, toHex, parseUnits } from 'viem';

const SGD = (n: string) => parseUnits(n, 6);
const MERCHANT_ID = keccak256(toHex('supadb'));
const CAMPAIGN_ID = keccak256(toHex('campaign-1'));
const PROJECT_ID = keccak256(toHex('project-1'));
const DAY = 86400;

async function deploy() {
  const [sponsor, dev, agent, attacker] = await hre.viem.getWalletClients();

  // XSGD giả — ERC-20 tối giản đủ để test
  const xsgd = await hre.viem.deployContract('MockXSGD', []);
  const registry = await hre.viem.deployContract('MerchantRegistry', []);
  const gm = await hre.viem.deployContract('GrantManager', [xsgd.address, registry.address]);

  await registry.write.register([MERCHANT_ID, dev.account.address, 'SupaDB', keccak256(toHex('database'))]);
  await xsgd.write.mint([sponsor.account.address, SGD('1000')]);
  await xsgd.write.approve([gm.address, SGD('1000')]);

  await gm.write.createCampaign([
    CAMPAIGN_ID,
    {
      sponsor: sponsor.account.address,
      merchantId: MERCHANT_ID,
      funded: 0n, committed: 0n,
      grantAmount: SGD('50'),
      trancheCount: 5, tranchePeriod: 2 * DAY,
      minSpendPerTranche: SGD('8'), minDaysPerTranche: 1,
      grantValidity: BigInt(30 * DAY),
      perTxCap: SGD('5'), dailyCap: SGD('8'),
      attestor: '0x0000000000000000000000000000000000000000',
      paused: false,
      asset: 0,
    },
  ]);
  await gm.write.fund([CAMPAIGN_ID, SGD('500')]);

  return { gm, xsgd, registry, sponsor, dev, agent, attacker };
}

describe('GrantManager', () => {
  it('phát Grant và nhả tranche đầu tiên', async () => {
    const { gm, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    const g = await gm.read.grantOf([PROJECT_ID]);
    expect(g[3]).to.equal(SGD('50'));  // total
    expect(g[4]).to.equal(SGD('10'));  // released = 50/5
  });

  it('MỘT projectId chỉ được MỘT Grant — fork repo không nhân bản được tiền', async () => {
    const { gm, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    await expect(
      gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]),
    ).to.be.rejected;
  });

  it('⚡ CHẶN unwrap sang merchant ngoài allowlist', async () => {
    const { gm, agent, dev, attacker } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    await expect(
      gm.write.unwrap([1n, attacker.account.address, SGD('1'), keccak256(toHex('n1'))], {
        account: agent.account,
      }),
    ).to.be.rejected;
  });

  it('⚡ CHẶN vượt trần mỗi giao dịch', async () => {
    const { gm, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    await expect(
      gm.write.unwrap([1n, dev.account.address, SGD('6'), keccak256(toHex('n2'))], {
        account: agent.account,
      }),
    ).to.be.rejected;
  });

  it('⚡ CHẶN vượt phần đã vest', async () => {
    const { gm, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    // đã vest 10, trần 5/lần, trần ngày 8 → lần 3 phải chặn
    await gm.write.unwrap([1n, dev.account.address, SGD('4'), keccak256(toHex('a'))], { account: agent.account });
    await gm.write.unwrap([1n, dev.account.address, SGD('4'), keccak256(toHex('b'))], { account: agent.account });
    await expect(
      gm.write.unwrap([1n, dev.account.address, SGD('4'), keccak256(toHex('c'))], { account: agent.account }),
    ).to.be.rejected;
  });

  it('unwrap hợp lệ chuyển XSGD sang signer', async () => {
    const { gm, xsgd, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    const before = await xsgd.read.balanceOf([agent.account.address]);
    await gm.write.unwrap([1n, dev.account.address, SGD('2'), keccak256(toHex('ok'))], { account: agent.account });
    const after = await xsgd.read.balanceOf([agent.account.address]);
    expect(after - before).to.equal(SGD('2'));
  });

  it('campaign AVAX chỉ nhận native fund và unwrap AVAX sang signer', async () => {
    const { gm, sponsor, dev, agent } = await deploy();
    const avaxCampaign = keccak256(toHex('campaign-avax'));
    const avaxProject = keccak256(toHex('project-avax'));
    const AVAX = (n: string) => parseUnits(n, 18);

    await gm.write.createCampaign([avaxCampaign, {
      sponsor: sponsor.account.address,
      merchantId: MERCHANT_ID,
      funded: 0n, committed: 0n,
      grantAmount: AVAX('2'),
      trancheCount: 2, tranchePeriod: DAY,
      minSpendPerTranche: 0n, minDaysPerTranche: 0,
      grantValidity: BigInt(30 * DAY),
      perTxCap: AVAX('0.5'), dailyCap: AVAX('1'),
      attestor: '0x0000000000000000000000000000000000000000',
      paused: false, asset: 1,
    }]);

    await expect(gm.write.fund([avaxCampaign, AVAX('5')])).to.be.rejected;
    await gm.write.fundAvax([avaxCampaign], { value: AVAX('5') });
    expect(await gm.read.assetOfGrant([0n])).to.equal(0);

    await gm.write.issueGrant([avaxCampaign, avaxProject, dev.account.address, agent.account.address]);
    expect(await gm.read.assetOfGrant([1n])).to.equal(1);
    const publicClient = await hre.viem.getPublicClient();
    const before = await publicClient.getBalance({ address: agent.account.address });
    await expect(gm.write.unwrap([1n, dev.account.address, AVAX('0.5'), keccak256(toHex('avax-wrong-path'))], { account: dev.account })).to.be.rejected;
    await gm.write.claimGas([1n, AVAX('0.5')], { account: dev.account });
    const after = await publicClient.getBalance({ address: agent.account.address });
    expect(after - before).to.equal(AVAX('0.5'));
    expect(await publicClient.getBalance({ address: gm.address })).to.equal(AVAX('4.5'));
  });

  it('campaign XSGD từ chối fundAvax để không trộn tài sản', async () => {
    const { gm } = await deploy();
    await expect(gm.write.fundAvax([CAMPAIGN_ID], { value: parseUnits('1', 18) })).to.be.rejected;
  });

  it('⚡ CHẶN unwrap sau khi sponsor thu hồi', async () => {
    const { gm, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    await gm.write.revokeGrant([1n]);
    await expect(
      gm.write.unwrap([1n, dev.account.address, SGD('1'), keccak256(toHex('r'))], { account: agent.account }),
    ).to.be.rejected;
  });

  it('merchant bị deactivate biến mất khỏi allowlist và không thể unwrap', async () => {
    const { gm, registry, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);
    await registry.write.deactivate([MERCHANT_ID]);

    expect(await gm.read.allowedPayTo([1n])).to.deep.equal([]);
    await expect(
      gm.write.unwrap([1n, dev.account.address, SGD('1'), keccak256(toHex('disabled'))], { account: agent.account }),
    ).to.be.rejected;
  });

  it('claimTranche cần đủ thời gian VÀ đủ mức chi', async () => {
    const { gm, agent, dev } = await deploy();
    await gm.write.issueGrant([CAMPAIGN_ID, PROJECT_ID, dev.account.address, agent.account.address]);

    // chưa tới hạn → chặn
    await expect(gm.write.claimTranche([1n])).to.be.rejected;

    await hre.network.provider.send('evm_increaseTime', [2 * DAY + 1]);
    await hre.network.provider.send('evm_mine', []);

    // đủ thời gian nhưng chưa tiêu đủ 8 SGD → vẫn chặn
    await expect(gm.write.claimTranche([1n])).to.be.rejected;

    await gm.write.unwrap([1n, dev.account.address, SGD('5'), keccak256(toHex('t1'))], { account: agent.account });
    await gm.write.unwrap([1n, dev.account.address, SGD('3'), keccak256(toHex('t2'))], { account: agent.account });

    await gm.write.claimTranche([1n]);
    const g = await gm.read.grantOf([PROJECT_ID]);
    expect(g[4]).to.equal(SGD('20')); // released 10 → 20
  });
});
