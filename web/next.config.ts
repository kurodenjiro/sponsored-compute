import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * Cho phép import code dùng chung ở ../src.
 * extensionAlias: các file .ts trong ../src import lẫn nhau bằng đuôi '.js'
 * (chuẩn ESM/NodeNext) — webpack cần được chỉ cách map ngược về .ts.
 */
const config: NextConfig = {
  // The repository root owns shared payment and contract code.
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  // @napi-rs/keyring là native .node — webpack không bundle được, phải để Node require thẳng
  serverExternalPackages: ['@napi-rs/keyring'],
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return cfg;
  },
};
export default config;
