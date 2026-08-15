/**
 * Deploy MerchantRegistry + GrantManager.
 *
 * Dùng XSGD THẬT của StraitsX (không deploy MockXSGD — cái đó chỉ cho unit test).
 * Ghi địa chỉ ra ../deployments/<chainId>.json để src/ đọc lại.
 */

import hre from 'hardhat';
import { writeFileSync, mkdirSync } from 'node:fs';
import { keccak256, toHex } from 'viem';

const XSGD: Record<number, `0x${string}`> = {
  43113: '0xd769410dc8772695a7f55a304d2125320a65c2a5',
  43114: '0xb2f85b7ab3c2b6f62df06de6ae7d09c010a5096e',
};

const MERCHANTS = [
  { id: 'supadb', name: 'SupaDB', category: 'database', payTo: '0xd077E3f3048AD97C50A08a31a95F4918278B31ac' },
  { id: 'neonlite', name: 'NeonLite', category: 'database', payTo: '0x1f212B0a09393F82B7E60D18c2e663f13DA5f7F0' },
  { id: 'sentrywatch', name: 'SentryWatch', category: 'monitoring', payTo: '0x619cdF38C1ed117CA0484207f838910dce77De47' },
] as const;

async function main() {
  const chainId = hre.network.config.chainId!;
  const xsgd = XSGD[chainId];
  if (!xsgd) throw new Error(`Chưa có địa chỉ XSGD cho chainId ${chainId}`);

  const [deployer] = await hre.viem.getWalletClients();
  const pub = await hre.viem.getPublicClient();
  const bal = await pub.getBalance({ address: deployer.account.address });
  console.log(`deployer ${deployer.account.address} · ${Number(bal) / 1e18} AVAX · chainId ${chainId}`);

  const registry = await hre.viem.deployContract('MerchantRegistry', []);
  console.log('MerchantRegistry :', registry.address);

  const gm = await hre.viem.deployContract('GrantManager', [xsgd, registry.address]);
  console.log('GrantManager     :', gm.address);

  // đăng ký merchant — CÓ KIỂM DUYỆT, chỉ owner làm được
  for (const m of MERCHANTS) {
    await registry.write.register([
      keccak256(toHex(m.id)),
      m.payTo as `0x${string}`,
      m.name,
      keccak256(toHex(m.category)),
    ]);
    console.log(`  đăng ký ${m.name.padEnd(12)} → ${m.payTo}`);
  }

  mkdirSync('../deployments', { recursive: true });
  const out = {
    chainId,
    xsgd,
    merchantRegistry: registry.address,
    grantManager: gm.address,
    merchants: MERCHANTS.map((m) => ({ ...m, id32: keccak256(toHex(m.id)) })),
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(`../deployments/${chainId}.json`, JSON.stringify(out, null, 2));
  console.log(`\nđã ghi deployments/${chainId}.json`);
  console.log(`\nthêm vào .env:\n  GRANT_MANAGER=${gm.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
