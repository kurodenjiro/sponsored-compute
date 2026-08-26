#!/usr/bin/env -S npx tsx
/**
 * The agent side of the NEAR flow, as a CLI.
 *
 * Only the steps that need the agent's own key live here. Sponsor and developer
 * steps go through the `near` CLI in scripts/near-spike.sh, so their full-access
 * keys stay in the OS keychain and are never printed, exported, or handed to a
 * script.
 *
 * Usage:
 *   npx tsx scripts/near-agent.ts pubkey
 *   npx tsx scripts/near-agent.ts evm-address <campaign>
 *   npx tsx scripts/near-agent.ts status  [campaign] [repo]   (no args: look up by our own key)
 *   npx tsx scripts/near-agent.ts pay     <campaign> <repo> <merchant> <amount> <max>
 *   npx tsx scripts/near-agent.ts pay-unchecked <merchant> <amount>   (demo only)
 *   npx tsx scripts/near-agent.ts tranche
 */

import { loadNearAgent } from '../src/near/signer.js';
import { NearGrantSource } from '../src/near/grant.js';
import { nearCheckpoint } from '../src/near/checkpoint.js';
import { explainDenial } from '../src/core/policy.js';
import { getNearNetwork, requireGrantManager } from '../src/near/config.js';

const GAS = 60_000_000_000_000n; // pay_merchant + ft_transfer + callback

function fmt(v: bigint, decimals: number) {
  const s = v.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const net = getNearNetwork();
  const contractId = requireGrantManager();

  // The address a campaign signs from on Base. The sponsor needs it twice: to
  // fund it, and to hand to `set_evm_leg`.
  if (cmd === 'evm-address') {
    const [campaign] = args;
    if (!campaign) throw new Error('usage: evm-address <campaign>');
    const { deriveCampaignAddress } = await import('../src/base/address.js');
    console.log(await deriveCampaignAddress(campaign));
    return;
  }

  if (cmd === 'pubkey') {
    const agent = await loadNearAgent({ quiet: true });
    console.log(agent.publicKey);
    return;
  }

  const source = new NearGrantSource();

  if (cmd === 'status') {
    const [campaign, repo] = args;
    // With no arguments, ask by the key we hold — no repo config to trust.
    const grant = campaign && repo
      ? await source.byRepo(campaign, repo)
      : await source.byKey((await loadNearAgent({ quiet: true })).publicKey);
    if (!grant) {
      console.log(
        campaign && repo
          ? `no grant for ${repo} under campaign "${campaign}" on ${net.caip2}`
          : `no grant bound to this agent key on ${net.caip2}`,
      );
      return;
    }
    const d = grant.asset.decimals;
    console.log(`grant #${grant.grantId}  campaign=${grant.campaignId}  repo=${grant.repo}`);
    console.log(`  spender    ${grant.spender}`);
    console.log(`  asset      ${grant.asset.symbol} (${grant.asset.id})`);
    console.log(`  released   ${fmt(grant.released, d)} of ${fmt(grant.total, d)}`);
    console.log(`  spent      ${fmt(grant.spent, d)}  (today ${fmt(grant.spentToday, d)} / ${fmt(grant.dailyCap, d)})`);
    console.log(`  per-tx cap ${fmt(grant.perTxCap, d)}`);
    console.log(`  merchants  ${grant.allowedPayees.map((p) => p.address).join(', ') || '(none)'}`);
    console.log(`  expires    ${new Date(grant.expiry * 1000).toISOString()}`);
    console.log(`  revoked    ${grant.revoked}`);
    return;
  }

  if (cmd === 'pay') {
    const [campaign, repo, merchant, amount, max] = args;
    const agent = await loadNearAgent({ quiet: true });
    const grant = await source.byRepo(campaign, repo);

    // 🔴 The invariant: checkpoint first, always, with no branch around it.
    const decision = nearCheckpoint({
      req: {
        scheme: 'exact',
        network: net.caip2,
        amount,
        asset: grant?.asset.id ?? '',
        payTo: merchant,
        extra: { assetTransferMethod: 'nep141' },
      },
      grant,
      callerMax: BigInt(max),
      publicKey: agent.publicKey,
    });
    if (!decision.ok) {
      console.error(explainDenial(decision));
      process.exit(2);
    }

    const out = await agent.account.callFunction<boolean>({
      contractId,
      methodName: 'pay_merchant',
      args: { to: merchant, amount, memo: `grant:${grant!.grantId}` },
      gas: GAS,
    });
    console.log(`paid ${amount} to ${merchant} — settled=${out}`);
    return;
  }

  // Layer-2 proof (§10 criterion 3): send a payment the client checkpoint would
  // have refused, and watch the contract refuse it anyway. CLI only — never an
  // MCP tool, and never on a path an agent can reach.
  if (cmd === 'pay-unchecked') {
    const [merchant, amount] = args;
    console.error('[demo] client checkpoint SKIPPED on purpose — the contract is the other layer');
    const agent = await loadNearAgent({ quiet: true });
    const out = await agent.account.callFunction<boolean>({
      contractId,
      methodName: 'pay_merchant',
      args: { to: merchant, amount, memo: 'unchecked' },
      gas: GAS,
    });
    console.log(`contract accepted it — settled=${out}`);
    return;
  }

  if (cmd === 'tranche') {
    const agent = await loadNearAgent({ quiet: true });
    const released = await agent.account.callFunction<string>({
      contractId,
      methodName: 'claim_tranche',
      args: {},
      gas: 30_000_000_000_000n,
    });
    console.log(`released now: ${released}`);
    return;
  }

  console.error(
    'commands: pubkey | evm-address <campaign> | status [campaign] [repo] | pay <campaign> <repo> <merchant> <amount> <max> | pay-unchecked <merchant> <amount> | tranche',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
