import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox-viem';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../platform-demo/.env.local' });

/**
 * Khoá deploy: dùng lại ví relayer (đã có AVAX).
 * Không hardcode khoá ở đây — đọc từ env.
 */
const KEY = process.env.RELAYER_PRIVATE_KEY;
const accounts = KEY ? [KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // grantOf() trả 11 giá trị → "stack too deep" với codegen cũ.
      // viaIR bật pipeline Yul, compile chậm hơn nhưng giữ nguyên ABI mà src/grant.ts đang đọc.
      viaIR: true,
    },
  },
  // giữ nguyên vị trí file .sol hiện có
  paths: { sources: './src', tests: './test', cache: './cache', artifacts: './artifacts' },
  networks: {
    fuji: {
      url: 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts,
      // RPC Avalanche từ chối tx EIP-1559 với phí ước lượng thấp — ép legacy
      gasPrice: 30_000_000_000,
    },
    avalanche: {
      url: 'https://api.avax.network/ext/bc/C/rpc',
      chainId: 43114,
      accounts,
      gasPrice: 30_000_000_000,
    },
  },
};

export default config;
