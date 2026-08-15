#!/usr/bin/env node
/**
 * MCP server — bề mặt DUY NHẤT mà agent (Claude Code / Codex / Cursor) nhìn thấy.
 *
 * 🔴 LUẬT 1 (docs/SPONSORED-COMPUTE.md §6): KHÔNG expose unwrap / sign /
 *    check_policy. Checkpoint chạy BÊN TRONG pay_for_service — LLM không thấy,
 *    không gọi được, không bỏ qua được.
 *
 * Hai tool onboarding (check_project_sponsorship / claim_sponsored_grant) nằm
 * ngoài đường tiêu tiền: chúng phát Grant chứ không chi Grant. Mọi ràng buộc
 * vẫn do GrantManager giữ, và claim là hành động tường minh của con người
 * (Luật 2) — agent không được tự claim khi user chưa yêu cầu.
 *
 * 🔴 Không tool nào trả về private key. Không có sign_anything.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { getSigner, agentAddress } from '../src/signer.js';
import { getGrantSource } from '../src/grant.js';
import { claimSponsoredGrant, readSponsorship } from '../src/claim.js';
import { formatAmount, projectIdOf } from '../src/campaign.js';
import { getNetwork, DEFAULT_CHAIN_ID, isMainnet } from '../src/config.js';
import { payX402, CheckpointDenied } from '../src/pay.js';
import { claimGasFromGrant } from '../src/unwrap.js';
import { renderPlatforms, findPlatform } from './platforms.js';
import { readManifest } from '../src/init.js';

const net = getNetwork();

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

const TOOLS = [
  {
    name: 'list_sponsored_platforms',
    description:
      'List platforms for a service category (database, monitoring, and more). ' +
      'Always includes unsponsored options and ranks by technical fit. ' +
      'Call only when the user asks; never create demand proactively.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: 'for example: "database" or "monitoring"' } },
    },
  },
  {
    name: 'check_project_sponsorship',
    description:
      'Answer "does this project have sponsorship?". Reads sponsored.json in the project root and ' +
      'verifies every campaign on-chain: does it exist, is it funded, has this wallet already claimed. ' +
      'Read-only: signs nothing and spends no gas.',
    inputSchema: {
      type: 'object',
      properties: {
        reward_wallet: { type: 'string', description: 'address that would own the Grant; defaults to the agent wallet' },
      },
    },
  },
  {
    name: 'claim_sponsored_grant',
    description:
      'Claim this project\'s Grant for one wallet. Call ONLY when the user explicitly asks to claim; ' +
      'never on your own initiative. Sends an on-chain issueGrant transaction that costs AVAX gas, ' +
      'writes the resulting projectId into sponsored.json, and reports the claim to the registry. ' +
      'One wallet gets one Grant per campaign; a second call just returns the existing Grant.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'bytes32; defaults to the first campaign in sponsored.json' },
        reward_wallet: { type: 'string', description: 'address that owns the Grant and receives the reward; defaults to the agent wallet' },
      },
    },
  },
  {
    name: 'get_grant_status',
    description:
      'Current Grant status: vested and spent amounts, caps, expiry, and approved recipients.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
    },
  },
  {
    name: 'pay_for_service',
    description:
      'Call a URL; if it returns HTTP 402, pay from the Grant and retry. ' +
      'max_amount is a required hard cap in atomic units (1000000 = 1.00 SGD). ' +
      'The call is denied when the endpoint exceeds that cap or is outside the Grant allowlist.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        max_amount: { type: 'string', description: 'atomic units, 6 decimals' },
        project_id: { type: 'string' },
        method: { type: 'string' },
        body: { type: 'object' },
      },
      required: ['url', 'max_amount'],
    },
  },
  {
    name: 'claim_avax_gas',
    description:
      'Release native AVAX from an AVAX gas Grant to the agent signer. ' +
      'Call ONLY when the user explicitly asks for gas; never claim proactively. ' +
      'amount is atomic AVAX (1 AVAX = 1000000000000000000). Contract caps, vesting and expiry are enforced.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string', description: 'atomic AVAX units, 18 decimals' },
        project_id: { type: 'string' },
      },
      required: ['amount'],
    },
  },
];

/**
 * claim_sponsored_grant records projectId in sponsored.json. If the tools that
 * spend the Grant never read it back, that pointer is useless: right after a
 * successful claim the agent still answers "No Grant exists" unless the
 * developer exports PROJECT_ID by hand. Precedence: call argument > env > the
 * pointer recorded in the repo.
 *
 * sponsored.json lives in the repo, so it is UNTRUSTED input. A projectId is
 * derivable from campaignId + wallet, both public on-chain, so a malicious repo
 * could pre-record someone else's projectId. unwrap() is permissionless and
 * always pays out to the Grant's own signer, so pointing at a third party's
 * Grant would burn their budget. Therefore take only campaignId from the file
 * and DERIVE the projectId for this agent's own wallet.
 *
 * Read-only paths must not mint a wallet, so this never creates a key: with no
 * wallet yet there is no Grant to find either.
 */
async function resolveProjectId(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (process.env.PROJECT_ID) return process.env.PROJECT_ID;

  const pointer = readManifest()?.campaigns.find((c) => c.campaignId);
  if (!pointer?.campaignId) return '0x';
  const wallet = await agentAddress();
  if (!wallet) return '0x';
  return projectIdOf(pointer.campaignId, wallet);
}

const server = new Server(
  { name: 'sponsored-compute', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params as any;

  try {
    switch (name) {
      case 'list_sponsored_platforms':
        return text(renderPlatforms(args.category));

      case 'check_project_sponsorship': {
        /**
         * This tool is documented as read-only, so it must not mint a key.
         * getSigner() generates and persists an EOA when none exists, which
         * turned "does this repo have sponsorship?" into a silent wallet
         * creation on the user's machine. Creation belongs to claim, where the
         * user has explicitly asked for it.
         */
        const wallet = args.reward_wallet ?? (await agentAddress());
        if (!wallet) {
          return text(
            'No agent wallet exists yet, so there is nothing to check a claim against.\n'
            + 'Claiming a Grant creates one — run claim_sponsored_grant when you want that, '
            + 'or set AGENT_PRIVATE_KEY to use an existing wallet.',
          );
        }
        const found = await readSponsorship({ wallet });
        if (found.length === 0) {
          return text('No sponsored.json in this project. It carries no sponsorship pointer, so there is nothing to claim.');
        }
        return text(found.map((s) => {
          const head = `${s.pointer.repo ?? s.pointer.campaignId} · sponsor ${s.pointer.sponsor} · chain ${s.pointer.chainId}`;
          if (!s.campaign) return `${head}\n  ✗ ${s.reason}`;
          const decimals = s.campaign.asset === 1 ? 18 : 6;
          const symbol = s.campaign.asset === 1 ? 'AVAX' : 'XSGD';
          const fmt = (value: bigint) => formatAmount(value, decimals);
          const available = s.campaign.funded - s.campaign.committed;
          return [
            head,
            `  grant per developer : ${fmt(s.campaign.grantAmount)} ${symbol}`,
            `  uncommitted pool    : ${fmt(available)} ${symbol}  (${available / s.campaign.grantAmount} seats left)`,
            `  grant mode          : ${s.campaign.asset === 1 ? 'native AVAX gas' : 'XSGD x402 payment'}`,
            `  caps                : ${fmt(s.campaign.perTxCap)}/transaction · ${fmt(s.campaign.dailyCap)}/day`,
            s.grantId ? `  ✓ already claimed by ${wallet} — Grant ${s.grantId}` : `  ${s.claimable ? '→ claimable' : '✗ ' + s.reason} for ${wallet}`,
          ].join('\n');
        }).join('\n\n') + '\n\nClaiming is the user\'s decision: ask before calling claim_sponsored_grant.');
      }

      case 'claim_sponsored_grant': {
        const out = await claimSponsoredGrant({
          campaignId: args.campaign_id,
          rewardWallet: args.reward_wallet,
        });
        if (!out.ok) return text(`Claim denied: ${out.error}`);
        const link = out.transaction ? `\n  transaction: ${net.explorer}/tx/${out.transaction}` : '';
        return text([
          out.alreadyClaimed
            ? `This wallet already holds Grant ${out.grantId} for this campaign. Nothing was issued and no gas was spent.`
            : `✓ Grant ${out.grantId} issued.${link}`,
          `  projectId: ${out.projectId}  (written to sponsored.json)`,
          out.registered
            ? '  registry: claim recorded'
            : `  registry: not recorded (${out.registryError}) — the Grant is valid on-chain regardless`,
          '',
          'Use the tool matching its asset: pay_for_service for XSGD, claim_avax_gas for AVAX. Contract caps apply to both.',
        ].join('\n'));
      }

      case 'get_grant_status': {
        const g = await getGrantSource().get(await resolveProjectId(args.project_id));
        if (!g) return text('No Grant exists for this project. Ask the user to choose a platform first.');
        const decimals = g.asset === 1 ? 18 : 6;
        const symbol = g.asset === 1 ? 'AVAX' : 'XSGD';
        const fmt = (value: bigint) => formatAmount(value, decimals);
        return text(
          [
            `Grant ${g.grantId}  (project ${g.projectId})`,
            `  asset     : ${symbol} · ${g.asset === 1 ? 'gas grant' : 'x402 payment grant'}`,
            `  vested    : ${fmt(g.released)} / ${fmt(g.total)} ${symbol}`,
            `  spent     : ${fmt(g.spent)} ${symbol}  (today ${fmt(g.spentToday)})`,
            `  available : ${fmt(g.released - g.spent)} ${symbol}`,
            `  caps      : ${fmt(g.perTxCap)}/transaction · ${fmt(g.dailyCap)}/day`,
            `  expiry    : ${new Date(g.expiry * 1000).toISOString()}`,
            g.asset === 0 ? `  pay only to: ${g.allowedPayTo.join(', ') || '(none)'}` : '  destination : agent signer (gas only)',
            g.revoked ? '  ⚠️ REVOKED' : '',
          ].filter(Boolean).join('\n'),
        );
      }

      case 'pay_for_service': {
        const signer = await getSigner();
        const grant = await getGrantSource().get(await resolveProjectId(args.project_id));

        /**
         * Khi có GRANT_MANAGER thì BẮT BUỘC đi qua unwrap() on-chain.
         * Thiếu chỗ này thì tiền lấy từ số dư riêng của agent, két Grant không
         * bị trừ, và lớp enforce ở contract KHÔNG được kích hoạt — chỉ còn
         * checkpoint phía client, mà client thì sửa được.
         */
        const grantManager = (process.env.GRANT_MANAGER ?? net.grantManager) as `0x${string}` | undefined;

        // ⟵ checkpoint chạy BÊN TRONG payX402. Không có đường vòng.
        const res = await payX402({
          url: args.url,
          method: args.method ?? 'POST',
          body: args.body,
          maxAmount: BigInt(args.max_amount),
          signer,
          grant,
          ...(grantManager && grant ? { grantManager, grantId: BigInt(grant.grantId) } : {}),
        });

        return text(
          [
            `HTTP ${res.status}` +
              (res.paidAmount > 0n ? ` · paid ${(Number(res.paidAmount) / 1e6).toFixed(2)} SGD` : ''),
            res.settlementHeader ? `settlement: ${res.settlementHeader}` : '',
            typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2),
          ].filter(Boolean).join('\n'),
        );
      }

      case 'claim_avax_gas': {
        const grant = await getGrantSource().get(await resolveProjectId(args.project_id));
        if (!grant) return text('No Grant exists for this project.');
        if (grant.asset !== 1) return text('Denied: this is an XSGD payment Grant, not an AVAX gas Grant.');
        let amount: bigint;
        try { amount = BigInt(args.amount); } catch { return text('Denied: amount must be an integer in atomic AVAX units.'); }
        if (amount <= 0n) return text('Denied: amount must be greater than zero.');
        const grantManager = (process.env.GRANT_MANAGER ?? net.grantManager) as `0x${string}` | undefined;
        if (!grantManager) return text('Denied: no GrantManager is configured for this network.');
        const out = await claimGasFromGrant({ grantManager, grantId: BigInt(grant.grantId), amount });
        if (!out.ok) return text(`AVAX gas claim denied: ${out.error}`);
        return text(`✓ Released ${formatAmount(amount, 18)} AVAX to the agent signer.\ntransaction: ${net.explorer}/tx/${out.transaction}`);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    // A checkpoint denial is a valid result: state the reason without suggesting a bypass.
    if (e instanceof CheckpointDenied) return text(e.message);
    return text(`Error: ${e?.message ?? String(e)}`);
  }
});

async function main() {
  console.error(
    `[sponsored-compute] ${net.name}/${net.chainId}` +
      `${isMainnet() ? ' — 🔴 MAINNET, TIỀN THẬT' : ''} · facilitator ${net.facilitator}`,
  );
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error('[sponsored-compute] failed to start:', e);
  process.exit(1);
});
