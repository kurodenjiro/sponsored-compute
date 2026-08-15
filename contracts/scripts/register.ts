/**
 * Đăng ký merchant vào MerchantRegistry đã deploy — idempotent, chờ receipt từng tx.
 *
 * Vì sao tách khỏi deploy.ts: viem gửi tx liên tiếp mà không chờ xác nhận sẽ
 * dùng lại nonce → RPC Avalanche trả "replacement transaction underpriced".
 * Phải await receipt sau MỖI lần ghi.
 */

import hre from 'hardhat';
import { keccak256, toHex, getAddress } from 'viem';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const REGISTRY = process.env.MERCHANT_REGISTRY ?? '0x474fef451ddda48a8b1c6f3450daf8e76120a9be';
const GRANT_MANAGER = process.env.GRANT_MANAGER ?? '0x3230b5666d8de86d3079d07bb45a7075a1d0b043';

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
  const pub = await hre.viem.getPublicClient();
  const registry = await hre.viem.getContractAt('MerchantRegistry', getAddress(REGISTRY));

  for (const m of MERCHANTS) {
    const id32 = keccak256(toHex(m.id));
    const existing = (await registry.read.payToOf([id32])) as string;

    if (existing !== '0x0000000000000000000000000000000000000000') {
      console.log(`  ✓ ${m.name.padEnd(12)} đã có → ${existing}`);
      continue;
    }

    const hash = await registry.write.register([
      id32, m.payTo as `0x${string}`, m.name, keccak256(toHex(m.category)),
    ]);
    await pub.waitForTransactionReceipt({ hash }); // ⟵ BẮT BUỘC chờ, tránh đụng nonce
    console.log(`  + ${m.name.padEnd(12)} đăng ký → ${m.payTo}`);
  }

  mkdirSync('../deployments', { recursive: true });
  const file = `../deployments/${chainId}.json`;
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  writeFileSync(
    file,
    JSON.stringify(
      {
        ...prev,
        chainId,
        xsgd: XSGD[chainId],
        merchantRegistry: getAddress(REGISTRY),
        grantManager: getAddress(GRANT_MANAGER),
        merchants: MERCHANTS.map((m) => ({ ...m, id32: keccak256(toHex(m.id)) })),
        updatedAt: new Date().toISOString(),
      },
      null, 2,
    ),
  );
  console.log(`\nđã ghi deployments/${chainId}.json`);
}

main().catch((e) => {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
