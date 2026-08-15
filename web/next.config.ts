import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * Cho phép import code dùng chung ở ../src.
 * extensionAlias: các file .ts trong ../src import lẫn nhau bằng đuôi '.js'
 * (chuẩn ESM/NodeNext) — webpack cần được chỉ cách map ngược về .ts.
 */
const config: NextConfig = {
  // Keep development output separate from production builds. This means a
  // concurrent `next build` cannot delete manifests used by `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The repository root owns shared payment and contract code.
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  // @napi-rs/keyring là native .node — webpack không bundle được, phải để Node require thẳng
  serverExternalPackages: ['@napi-rs/keyring'],
  webpack: (cfg) => {
    // The web app imports shared code from ../src. On Vercel, dependencies are
    // installed in web/node_modules (the configured Root Directory), while
    // Node's normal upward lookup from ../src would only search the repository
    // root. Include the web dependency directory explicitly for those imports.
    cfg.resolve.modules = [
      path.join(process.cwd(), 'node_modules'),
      ...(cfg.resolve.modules ?? []),
    ];
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return cfg;
  },
};
export default config;
