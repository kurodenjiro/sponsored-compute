import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  webpack: (c) => { c.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }; return c; },
};
export default config;
