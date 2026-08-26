/**
 * The agent's NEAR identity.
 *
 * Unlike the EVM path there is no agent *account* — the grant's FunctionCall
 * access key lives on `grant-manager.near` itself (see contract-near/src/lib.rs,
 * "Where the access key lives"). So the agent holds a keypair and signs as the
 * contract account, and the contract recognises the grant by
 * `env::signer_account_pk()`.
 *
 * Practical consequences worth knowing before debugging this:
 *   - the agent needs no NEAR balance and no account of its own
 *   - the key can only reach two methods on one contract, and cannot attach NEAR
 *   - the sponsor can delete it without the agent's cooperation
 */

import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { loadSecret } from '../core/keystore.js';
import { getNearNetwork, requireGrantManager } from './config.js';

const SPEC = {
  service: 'sponsored-compute',
  account: 'agent-near',
  fallbackFile: 'near-agent.json',
  envVar: 'AGENT_NEAR_SECRET_KEY',
  generate: () => KeyPair.fromRandom('ed25519').toString(),
};

export interface NearAgent {
  /** `ed25519:…` — what goes into `claim_grant`, and what identifies the grant. */
  publicKey: string;
  /** The account the key signs as: the grant-manager contract. */
  accountId: string;
  account: Account;
  storeKind: string;
}

/** The agent's public key, or null when no key exists and creating one wasn't asked for. */
export async function agentPublicKey(opts: { create?: boolean } = {}): Promise<string | null> {
  const found = await loadSecret(SPEC, opts);
  return found ? KeyPair.fromString(found.secret as KeyPairString).getPublicKey().toString() : null;
}

export function nearProvider(networkId?: string): JsonRpcProvider {
  return new JsonRpcProvider({ url: getNearNetwork(networkId).rpc });
}

export async function loadNearAgent(
  opts: { networkId?: string; create?: boolean; quiet?: boolean } = {},
): Promise<NearAgent> {
  const found = await loadSecret(SPEC, { create: opts.create ?? true });
  if (!found) {
    throw new Error('no NEAR agent key yet - run `sponsored-compute address` or set AGENT_NEAR_SECRET_KEY');
  }
  const keyPair = KeyPair.fromString(found.secret as KeyPairString);
  const accountId = requireGrantManager(opts.networkId);
  const account = new Account(accountId, nearProvider(opts.networkId), new KeyPairSigner(keyPair));
  const publicKey = keyPair.getPublicKey().toString();

  // Printed from inside the MCP server, so it surfaces on every tool call that
  // touches the key. The PUBLIC key only — never the secret.
  if (!opts.quiet) {
    console.error(
      `[signer] NEAR agent key ${found.created ? 'created' : 'loaded'}: ${publicKey}  (stored: ${found.kind})`,
    );
    if (found.kind.startsWith('file')) {
      console.error(`[signer] warning: no OS keychain found — using ${found.file}`);
    }
  }
  return { publicKey, accountId, account, storeKind: found.kind };
}
