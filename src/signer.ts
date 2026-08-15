/**
 * Signer — EOA local, khoá lưu trong OS keychain.
 *
 * Vì sao EOA chứ không phải smart account: XSGD KHÔNG hỗ trợ ERC-1271
 * (đã đọc bytecode impl 0x3f811bb6e605ef518b0cd9281eb4d9ad88a3953f — không có
 * selector 1626ba7e). transferWithAuthorization dùng ecrecover, nên chữ ký
 * BẮT BUỘC là ECDSA từ EOA. Ví ERC-4337 (Crossmint, 0xGasless) sẽ revert.
 *
 * Threat model — nói thật:
 *   ✅ không nằm plaintext trên disk
 *   ✅ không bao giờ vào context LLM (không tool nào trả về khoá)
 *   ✅ không bị commit vào git
 *   ❌ KHÔNG chống được agent local bị chiếm quyền hoàn toàn
 * Cái chặn thiệt hại thật là Grant có trần + hạn + revoke được.
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { TypedDataDefinition } from 'viem';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVICE = 'sponsored-compute';
const ACCOUNT = 'agent-eoa';
const FALLBACK_DIR = join(homedir(), '.sponsored-compute');
const FALLBACK_FILE = join(FALLBACK_DIR, 'wallet.json');

export interface Signer {
  address(): Promise<`0x${string}`>;
  signTypedData(d: TypedDataDefinition): Promise<`0x${string}`>;
}

type Store = {
  get(): Promise<string | null>;
  set(pk: string): Promise<void>;
  kind: string;
};

async function keyringStore(): Promise<Store | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const entry = new Entry(SERVICE, ACCOUNT);
    // xác nhận backend thật sự dùng được
    try { entry.getPassword(); } catch (e: any) {
      if (!/no.*entry|not found/i.test(String(e?.message))) throw e;
    }
    return {
      kind: 'os-keychain',
      async get() {
        try { return entry.getPassword(); } catch { return null; }
      },
      async set(pk) { entry.setPassword(pk); },
    };
  } catch {
    return null;
  }
}

function fileStore(): Store {
  return {
    kind: 'file (0600) — CHẾ ĐỘ YẾU HƠN, không có keychain',
    async get() {
      if (!existsSync(FALLBACK_FILE)) return null;
      return JSON.parse(readFileSync(FALLBACK_FILE, 'utf8')).privateKey ?? null;
    },
    async set(pk) {
      mkdirSync(FALLBACK_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(FALLBACK_FILE, JSON.stringify({ privateKey: pk }, null, 2), { mode: 0o600 });
      chmodSync(FALLBACK_FILE, 0o600);
    },
  };
}

/**
 * Nguồn khoá DUY NHẤT cho cả signer lẫn các đường ghi on-chain.
 *
 * Trước đây unwrap.agentKey() đọc thẳng keychain còn signer thì chấp nhận cả
 * file fallback. Trên máy không có OS keychain, signer tạo ví trong file và
 * báo "claimable", nhưng claim/pay lại không thấy khoá đâu và hỏng toàn bộ —
 * dù ví rõ ràng đang tồn tại. Mọi nơi phải đi qua đúng một hàm này.
 *
 * create=false là mặc định: sinh khoá là việc có hệ quả (ghi vĩnh viễn lên
 * máy người dùng), nên chỉ xảy ra khi caller nói rõ là muốn.
 */
export async function agentPrivateKey(
  opts: { create?: boolean } = {},
): Promise<{ pk: `0x${string}`; kind: string; created: boolean } | null> {
  if (process.env.AGENT_PRIVATE_KEY) {
    return { pk: process.env.AGENT_PRIVATE_KEY as `0x${string}`, kind: 'env', created: false };
  }
  const store = (await keyringStore()) ?? fileStore();
  const existing = await store.get();
  if (existing) return { pk: existing as `0x${string}`, kind: store.kind, created: false };
  if (!opts.create) return null;
  const pk = generatePrivateKey();
  await store.set(pk);
  return { pk, kind: store.kind, created: true };
}

/** Địa chỉ ví agent. Trả null khi chưa có ví và caller không cho phép tạo. */
export async function agentAddress(opts: { create?: boolean } = {}): Promise<`0x${string}` | null> {
  const found = await agentPrivateKey(opts);
  return found ? privateKeyToAccount(found.pk).address : null;
}

export class LocalKeyringSigner implements Signer {
  private account!: ReturnType<typeof privateKeyToAccount>;
  private constructor(private storeKind: string) {}

  static async load(opts: { quiet?: boolean } = {}): Promise<LocalKeyringSigner> {
    const found = await agentPrivateKey({ create: true });
    if (!found) throw new Error('could not obtain an agent key');
    const { pk, kind: storeKind, created } = found;
    const s = new LocalKeyringSigner(storeKind);
    s.account = privateKeyToAccount(pk);

    // This runs inside the MCP server process, so it prints on every tool
    // call that touches the wallet — an agent-visible line, not just a CLI
    // one. Print the ADDRESS only, never the key.
    if (!opts.quiet) {
      const tag = created ? 'created' : 'loaded';
      console.error(`[signer] agent wallet ${tag}: ${s.account.address}  (stored: ${storeKind})`);
      if (storeKind.startsWith('file')) {
        console.error(`[signer] warning: no OS keychain found — using ${FALLBACK_FILE}`);
      }
    }
    return s;
  }

  async address() { return this.account.address; }

  async signTypedData(d: TypedDataDefinition) {
    return this.account.signTypedData(d as any);
  }
}

/** --wallet=crossmint slots in here once §0 question 6 has an answer. */
export async function getSigner(kind = process.env.WALLET_KIND ?? 'local'): Promise<Signer> {
  if (kind !== 'local') {
    throw new Error(
      `wallet="${kind}" is not supported. Crossmint is an ERC-4337 smart account and cannot sign ` +
      'EIP-3009 for XSGD (XSGD lacks ERC-1271). See docs/SPONSORED-COMPUTE.md §2.',
    );
  }
  return LocalKeyringSigner.load();
}
