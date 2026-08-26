/**
 * Where agent secrets live: the OS keychain, or a `0600` file when there is no
 * keychain backend. Shared by the EVM signer and the NEAR signer so both obey
 * one policy — an earlier split had the signer accept the file fallback while
 * the on-chain write path only read the keychain, so on a machine without a
 * keychain the wallet existed and every spend failed anyway.
 *
 * Threat model, stated plainly:
 *   ✅ never in plaintext on disk (keychain path)
 *   ✅ never enters the model's context — no tool returns a key
 *   ✅ never committed to git
 *   ❌ does NOT survive a fully compromised local agent
 * What actually bounds the damage is the Grant: capped, expiring, merchant-bound,
 * revocable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SecretStore {
  kind: string;
  get(): Promise<string | null>;
  set(secret: string): Promise<void>;
}

export const SECRETS_DIR = join(homedir(), '.sponsored-compute');

async function keyringStore(service: string, account: string): Promise<SecretStore | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const entry = new Entry(service, account);
    // Confirm the backend is actually usable before claiming it.
    try {
      entry.getPassword();
    } catch (e: any) {
      if (!/no.*entry|not found/i.test(String(e?.message))) throw e;
    }
    return {
      kind: 'os-keychain',
      async get() {
        try {
          return entry.getPassword();
        } catch {
          return null;
        }
      },
      async set(secret) {
        entry.setPassword(secret);
      },
    };
  } catch {
    return null;
  }
}

function fileStore(file: string): SecretStore {
  return {
    kind: `file (0600) — WEAKER MODE, no keychain available`,
    async get() {
      if (!existsSync(file)) return null;
      const j = JSON.parse(readFileSync(file, 'utf8'));
      // `privateKey` is what the EVM-only signer wrote before this module
      // existed. Dropping it would strand a real wallet — and with it the
      // Grant that wallet owns — on any machine without a keychain.
      return j.secret ?? j.privateKey ?? null;
    },
    async set(secret) {
      mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(file, JSON.stringify({ secret }, null, 2), { mode: 0o600 });
      chmodSync(file, 0o600);
    },
  };
}

export interface SecretSpec {
  service: string;
  account: string;
  /** Filename inside `~/.sponsored-compute` used when there is no keychain. */
  fallbackFile: string;
  /** Env var that overrides the store entirely — for CI. */
  envVar?: string;
  generate: () => string;
}

/**
 * `create` defaults to false: minting a key writes permanently to the user's
 * machine, so it only happens when the caller says so.
 */
export async function loadSecret(
  spec: SecretSpec,
  opts: { create?: boolean } = {},
): Promise<{ secret: string; kind: string; created: boolean; file: string } | null> {
  const file = join(SECRETS_DIR, spec.fallbackFile);
  const fromEnv = spec.envVar ? process.env[spec.envVar] : undefined;
  if (fromEnv) return { secret: fromEnv, kind: 'env', created: false, file };

  const store = (await keyringStore(spec.service, spec.account)) ?? fileStore(file);
  const existing = await store.get();
  if (existing) return { secret: existing, kind: store.kind, created: false, file };
  if (!opts.create) return null;
  const secret = spec.generate();
  await store.set(secret);
  return { secret, kind: store.kind, created: true, file };
}
