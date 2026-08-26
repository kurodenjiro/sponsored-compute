/**
 * Reads grant state from `grant-manager.near` and maps it onto the neutral
 * `Grant` in `src/core/types.ts`. View calls are free, so the policy layer
 * always works from live chain state rather than a cached copy.
 */

import { JsonRpcProvider } from 'near-api-js';
import type { Caip2, Grant, Payee } from '../core/types.js';
import { getNearNetwork, requireGrantManager, tokenById } from './config.js';
import { nearProvider } from './signer.js';

const DAY_NS = 86_400_000_000_000n;

/** `Grant` as the contract serialises it. U128/U64 arrive as strings. */
interface RawGrant {
  id: string;
  campaign_id: string;
  repo: string;
  owner: string;
  agent_pk: string;
  total: string;
  released: string;
  spent: string;
  spent_today: string;
  day: string;
  spent_at_tranche: string;
  tranche_claimed: number;
  issued_at_ns: string;
  expiry_ns: string;
  revoked: boolean;
}

interface RawEvmLeg {
  chain_id: number;
  token: string;
  token_name: string;
  token_version: string;
  address: string;
}

interface RawCampaign {
  sponsor: string;
  token_id: string;
  merchants: string[];
  evm: RawEvmLeg | null;
  evm_merchants: string[];
  funded: string;
  committed: string;
  grant_amount: string;
  tranche_count: number;
  per_tx_cap: string;
  daily_cap: string;
  paused: boolean;
}

export class NearGrantSource {
  kind = 'near-view';
  private provider: JsonRpcProvider;

  constructor(
    private networkId?: string,
    private grantManager = requireGrantManager(networkId),
    provider?: JsonRpcProvider,
  ) {
    this.provider = provider ?? nearProvider(networkId);
  }

  /** `callFunction` is typed for JSON scalars/objects; our views also return null. */
  private async view<T>(methodName: string, args: Record<string, unknown>): Promise<T | null> {
    const out = await this.provider.callFunction<object>({
      contractId: this.grantManager,
      method: methodName,
      args,
    });
    return (out ?? null) as T | null;
  }

  async byRepo(campaignId: string, repo: string): Promise<Grant | null> {
    const raw = await this.view<RawGrant>('get_grant_by_repo', {
      campaign_id: campaignId,
      repo,
    });
    return raw ? this.hydrate(raw) : null;
  }

  /**
   * Find the grant from the key that spends it.
   *
   * This is the lookup the agent can always do: it holds the key and nothing
   * else. Going through `campaign_id` + `repo` means trusting a `sponsored.json`
   * that lives in the repo — public, editable, and able to point at someone
   * else's grant.
   */
  async byKey(publicKey: string): Promise<Grant | null> {
    const raw = await this.view<RawGrant>('get_grant_by_key', { public_key: publicKey });
    return raw ? this.hydrate(raw) : null;
  }

  async byId(grantId: string | number): Promise<Grant | null> {
    const raw = await this.view<RawGrant>('get_grant', { grant_id: String(grantId) });
    return raw ? this.hydrate(raw) : null;
  }

  async getCampaign(campaignId: string): Promise<RawCampaign | null> {
    return this.view<RawCampaign>('get_campaign', { id: campaignId });
  }

  private async hydrate(raw: RawGrant): Promise<Grant> {
    const net = getNearNetwork(this.networkId);
    const c = await this.getCampaign(raw.campaign_id);
    if (!c) throw new Error(`grant ${raw.id} points at a campaign that does not exist`);

    const known = tokenById(c.token_id, this.networkId);
    const payees: Payee[] = c.merchants.map((address) => ({ chain: net.caip2, address }));

    // The Base leg, when the sponsor has configured one. Both lists stay keyed
    // by chain: an address allowlisted on Sepolia must not authorise a payment
    // on mainnet just because the bytes match.
    const chains: Caip2[] = [net.caip2];
    const assets: string[] = [c.token_id];
    if (c.evm) {
      const evmChain = `eip155:${c.evm.chain_id}`;
      chains.push(evmChain);
      assets.push(c.evm.token);
      payees.push(...c.evm_merchants.map((address) => ({ chain: evmChain, address })));
    }

    // `spent_today` is only meaningful for the day it was stamped. The contract
    // resets it lazily on the next spend, so a stale value read here would let
    // the client think yesterday's spending still counts against today's cap —
    // the wrong direction to be wrong in either way.
    const today = BigInt(Date.now()) * 1_000_000n / DAY_NS;
    const spentToday = BigInt(raw.day) === today ? BigInt(raw.spent_today) : 0n;

    return {
      grantId: raw.id,
      campaignId: raw.campaign_id,
      repo: raw.repo,
      spender: raw.agent_pk,
      homeChain: net.caip2,
      asset: known ?? { id: c.token_id, symbol: c.token_id, decimals: 0 },
      spendableChains: chains,
      spendableAssets: assets,
      allowedPayees: payees,
      total: BigInt(raw.total),
      released: BigInt(raw.released),
      spent: BigInt(raw.spent),
      spentToday,
      perTxCap: BigInt(c.per_tx_cap),
      dailyCap: BigInt(c.daily_cap),
      expiry: Number(BigInt(raw.expiry_ns) / 1_000_000_000n),
      // A paused campaign must look exactly like a revoked grant to the policy
      // layer — same as `grantOf()` did on the Solidity side.
      revoked: raw.revoked || c.paused,
    };
  }
}
