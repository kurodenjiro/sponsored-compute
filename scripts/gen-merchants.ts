/**
 * Sinh ví merchant cho demo.
 *
 * Đây là các địa chỉ NHẬN tiền (payTo) — cần xin 0xGasless whitelist,
 * vì facilitator công khai khoá người nhận XSGD (§13.0).
 *
 * Khoá lưu ở .merchants.json (đã gitignore). Giá trị thấp — chỉ để demo
 * và để rút lại XSGD test sau khi chạy.
 *
 * Chạy: npx tsx scripts/gen-merchants.ts
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

const FILE = '.merchants.json';

const MERCHANTS = [
  { id: 'supadb', name: 'SupaDB', category: 'database' },
  { id: 'neonlite', name: 'NeonLite', category: 'database' },
  { id: 'sentrywatch', name: 'SentryWatch', category: 'monitoring' },
];

type Row = { id: string; name: string; category: string; address: string; privateKey: string };

let rows: Row[];

if (existsSync(FILE)) {
  rows = JSON.parse(readFileSync(FILE, 'utf8'));
  console.log(`(đã có ${FILE} — dùng lại, không sinh mới)\n`);
} else {
  rows = MERCHANTS.map((m) => {
    const pk = generatePrivateKey();
    return { ...m, address: privateKeyToAccount(pk).address, privateKey: pk };
  });
  writeFileSync(FILE, JSON.stringify(rows, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
  console.log(`đã ghi ${FILE} (chmod 600)\n`);
}

console.log('Địa chỉ merchant cần xin whitelist — Avalanche C-Chain mainnet (43114), token XSGD:\n');
for (const r of rows) {
  console.log(`  ${r.address}   ${r.name}  (${r.category})`);
}

console.log('\n--- dán vào .env của platform-demo ---');
for (const r of rows) {
  console.log(`MERCHANT_PAYTO_${r.id.toUpperCase()}=${r.address}`);
}
