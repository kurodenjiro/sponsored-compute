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

export class LocalKeyringSigner implements Signer {
  private account!: ReturnType<typeof privateKeyToAccount>;
  private constructor(private storeKind: string) {}

  static async load(opts: { quiet?: boolean } = {}): Promise<LocalKeyringSigner> {
    const store = (await keyringStore()) ?? fileStore();
    const s = new LocalKeyringSigner(store.kind);

    let pk = process.env.AGENT_PRIVATE_KEY ?? (await store.get());
    let created = false;
    if (!pk) {
      pk = generatePrivateKey();
      await store.set(pk);
      created = true;
    }
    s.account = privateKeyToAccount(pk as `0x${string}`);

    if (!opts.quiet) {
      const tag = created ? 'đã TẠO MỚI' : 'đã nạp';
      // in ĐỊA CHỈ, không bao giờ in khoá
      console.error(`[signer] ví agent ${tag}: ${s.account.address}  (lưu ở: ${store.kind})`);
      if (store.kind.startsWith('file')) {
        console.error(`[signer] ⚠️  không tìm thấy OS keychain — dùng ${FALLBACK_FILE}`);
      }
    }
    return s;
  }

  async address() { return this.account.address; }

  async signTypedData(d: TypedDataDefinition) {
    return this.account.signTypedData(d as any);
  }
}

/** --wallet=crossmint lắp vào đây khi §0 câu 6 có đáp án. */
export async function getSigner(kind = process.env.WALLET_KIND ?? 'local'): Promise<Signer> {
  if (kind !== 'local') {
    throw new Error(
      `wallet="${kind}" chưa hỗ trợ. Crossmint là ERC-4337 smart account → không ký được ` +
      `EIP-3009 cho XSGD (XSGD thiếu ERC-1271). Xem docs/SPONSORED-COMPUTE.md §2.`,
    );
  }
  return LocalKeyringSigner.load();
}
