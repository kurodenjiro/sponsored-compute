/**
 * The Base address a grant spends from.
 *
 * There is no wallet here and no private key anywhere — the address is derived
 * from `(grant-manager account, derivation path)` through NEAR's MPC signer, and
 * only the contract can produce a signature for it. That is what makes
 * `DeleteKey` stop EVM spending too (docs/ROADMAP-NEAR-MVP.md §6.1).
 *
 * Verified live 26/08/2026:
 *   gm.anyone3-pay.testnet + "grant-1" → 0x7De1259Cc50963091551B29DA22fDd01a0b8Ca79
 */

import bs58 from 'bs58';
import { publicKeyToAddress } from 'viem/utils';
import { nearProvider } from '../near/signer.js';
import { requireGrantManager } from '../near/config.js';

/** MPC signer contract, per NEAR network. */
export const MPC_SIGNER: Record<string, string> = {
  testnet: 'v1.signer-prod.testnet',
  mainnet: 'v1.signer',
};

/** secp256k1 — the curve EVM verifies with. Ed25519 (`1`) is for Solana/NEAR. */
export const DOMAIN_SECP256K1 = 0;

/** One Base address per campaign (§4.1). Grant-level paths stay available for attribution. */
export function campaignPath(campaignId: string): string {
  return `campaign-${campaignId}`;
}

export function grantPath(grantId: string): string {
  return `grant-${grantId}`;
}

/** NEAR encodes the key as `secp256k1:<base58 of the 64 uncompressed bytes>`. */
export function nearSecpKeyToAddress(publicKey: string): `0x${string}` {
  const [curve, encoded] = publicKey.split(':');
  if (curve !== 'secp256k1') throw new Error(`expected a secp256k1 key, got "${curve}"`);
  const raw = bs58.decode(encoded);
  if (raw.length !== 64) throw new Error(`expected 64 key bytes, got ${raw.length}`);
  return publicKeyToAddress(`0x04${Buffer.from(raw).toString('hex')}`);
}

export async function deriveEvmAddress(
  path: string,
  opts: { networkId?: string; grantManager?: string } = {},
): Promise<`0x${string}`> {
  const networkId = opts.networkId ?? 'testnet';
  const predecessor = opts.grantManager ?? requireGrantManager(networkId);
  const signer = MPC_SIGNER[networkId];
  if (!signer) throw new Error(`no MPC signer known for NEAR network "${networkId}"`);

  const publicKey = await nearProvider(networkId).callFunction<string>({
    contractId: signer,
    method: 'derived_public_key',
    args: { path, predecessor, domain_id: DOMAIN_SECP256K1 },
  });
  if (!publicKey) throw new Error(`derived_public_key returned nothing for ${predecessor} + "${path}"`);
  return nearSecpKeyToAddress(publicKey);
}

export function deriveCampaignAddress(campaignId: string, opts: Parameters<typeof deriveEvmAddress>[1] = {}) {
  return deriveEvmAddress(campaignPath(campaignId), opts);
}
