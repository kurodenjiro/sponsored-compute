/**
 * The Base payment flow, on the official x402 v2 client.
 *
 * The envelope, retry and settlement parsing come from `@x402/core` + `@x402/evm`
 * (docs.x402.org/getting-started/quickstart-for-buyers). Hand-rolling that was a
 * standing risk for no benefit — the wire format is theirs to version, not ours.
 *
 * What we do own is the signer. `ExactEvmScheme` says it plainly: *"Base flow
 * only requires `address` + `signTypedData`"*. So the plug point is a two-method
 * object, and ours is backed by `grant-manager.near` rather than a private key.
 *
 * 🔴 Why the checkpoint moved INTO the signer.
 *
 * `wrapFetchWithPayment` answers a 402 on its own — which would be a way to pay
 * without passing the checkpoint if the checkpoint sat in the request flow. It
 * does not: it runs inside `signTypedData`, so nothing can produce a signature
 * without passing it, no matter which transport wraps it.
 *
 * That placement is also stricter than checking the challenge. The bytes handed
 * to `signTypedData` are the bytes about to be signed, so a merchant that
 * advertises one price and steers the SDK into signing another is caught. The
 * challenge is a claim; this is the artifact.
 *
 * Three independent layers end up enforcing the same caps:
 *   1. the SDK's own `spendControls` (asset allowlist + per-payment ceiling)
 *   2. this checkpoint, on the typed data itself
 *   3. `grant-manager.near`, which rebuilds the digest from its own state
 */

import { x402Client, x402HTTPClient, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { evaluate, explainDenial, type Decision } from '../core/policy.js';
import type { Grant } from '../core/types.js';
import { getBaseNetwork, DEFAULT_CHAIN_ID } from './config.js';
import type { EvmToken } from './config.js';

/** EIP-3009 is how `exact` moves value on EVM; nothing else is honoured. */
const ALLOWED_TRANSFER_METHODS = ['eip3009'] as const;
const EIP3009_PRIMARY_TYPE = 'TransferWithAuthorization';

export class CheckpointDenied extends Error {
  constructor(public decision: Extract<Decision, { ok: false }>) {
    super(explainDenial(decision));
    this.name = 'CheckpointDenied';
  }
}

/**
 * Produces an EIP-3009 signature for the grant's derived Base address.
 *
 * Wave 1 task 1.2 implements this by calling `request_evm_signature` on
 * `grant-manager.near`. Note the shape: **fields, never a digest**. A requester
 * that took a pre-computed hash would let the caller have the contract sign
 * anything at all (docs/TASKS-NEAR.md §3, prohibition 4).
 */
export interface EvmSignatureRequester {
  requestSignature(input: {
    campaignId: string;
    to: `0x${string}`;
    amount: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: `0x${string}`;
    chainId: number;
    token: EvmToken;
  }): Promise<`0x${string}`>;
}

/** The two-method shape `ExactEvmScheme` needs. Deliberately nothing more. */
export interface GrantSigner {
  readonly address: `0x${string}`;
  signTypedData(m: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

/** Typed-data numbers arrive as bigint, number or decimal string depending on the caller. */
function asBigInt(v: unknown, field: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') {
    try { return BigInt(v); } catch { /* fall through */ }
  }
  throw new Error(`typed data field "${field}" is not an integer: ${String(v)}`);
}

function asAddress(v: unknown, field: string): `0x${string}` {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`typed data field "${field}" is not an address: ${String(v)}`);
  }
  return v as `0x${string}`;
}

export interface GrantSignerOptions {
  /** Derived from the NEAR contract — there is no key for it anywhere. */
  address: `0x${string}`;
  grant: Grant;
  /** The caller's own ceiling, from `pay_for_service(url, max_amount)`. */
  callerMax: bigint;
  requester: EvmSignatureRequester;
  chainId?: number;
  now?: number;
}

export function createGrantSigner(opts: GrantSignerOptions): GrantSigner {
  const chainId = opts.chainId ?? DEFAULT_CHAIN_ID;
  const net = getBaseNetwork(chainId);

  return {
    address: opts.address,

    async signTypedData({ domain, primaryType, message }) {
      if (primaryType !== EIP3009_PRIMARY_TYPE) {
        throw new Error(`refusing to sign primaryType "${primaryType}" — only ${EIP3009_PRIMARY_TYPE}`);
      }

      // The domain decides which contract the signature is valid against. A
      // merchant naming a different token, chain or version is asking us to
      // authorise a transfer somewhere we never agreed to.
      const token = net.usdc;
      const verifying = asAddress(domain.verifyingContract, 'domain.verifyingContract');
      const domainChain = Number(asBigInt(domain.chainId ?? chainId, 'domain.chainId'));
      if (verifying.toLowerCase() !== token.address.toLowerCase()) {
        throw new Error(`refusing to sign for token ${verifying}; ${net.caip2} uses ${token.address}`);
      }
      if (domainChain !== chainId) {
        throw new Error(`refusing to sign for chain ${domainChain} while spending on ${chainId}`);
      }
      if (domain.name !== token.eip712.name || domain.version !== token.eip712.version) {
        throw new Error(
          `refusing to sign under domain {${String(domain.name)}, ${String(domain.version)}}; ` +
            `${token.symbol} on chain ${chainId} uses {${token.eip712.name}, ${token.eip712.version}}`,
        );
      }

      const from = asAddress(message.from, 'from');
      if (from.toLowerCase() !== opts.address.toLowerCase()) {
        throw new Error(`typed data pays from ${from}, but this grant spends from ${opts.address}`);
      }
      const to = asAddress(message.to, 'to');
      const value = asBigInt(message.value, 'value');
      const validAfter = asBigInt(message.validAfter, 'validAfter');
      const validBefore = asBigInt(message.validBefore, 'validBefore');
      const nonce = message.nonce;
      if (typeof nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
        throw new Error(`typed data field "nonce" is not bytes32: ${String(nonce)}`);
      }

      // 🔴 CHECKPOINT — on the bytes about to be signed, not on the challenge.
      const decision = evaluate({
        intent: {
          chain: net.caip2,
          asset: token.address,
          payTo: to,
          amount: value.toString(),
          scheme: 'exact',
          transferMethod: 'eip3009',
        },
        grant: opts.grant,
        callerMax: opts.callerMax,
        allowedTransferMethods: ALLOWED_TRANSFER_METHODS,
        now: opts.now,
      });
      if (!decision.ok) throw new CheckpointDenied(decision);

      // The contract runs every check above again, from its own state, before
      // the MPC signer is asked for anything.
      return opts.requester.requestSignature({
        campaignId: opts.grant.campaignId,
        to,
        amount: value,
        validAfter,
        validBefore,
        nonce: nonce as `0x${string}`,
        chainId,
        token,
      });
    },
  };
}

export interface PayOptions extends GrantSignerOptions {
  url: string;
  init?: RequestInit;
}

export interface PayResult {
  status: number;
  body: unknown;
  /** `settled`, `settle_failed`, or absent when the resource needed no payment. */
  paymentStatus?: string;
  settlement?: unknown;
}

/**
 * Build a client bound to one grant. Registered for this chain only — a
 * wildcard `eip155:*` would let a merchant move the payment to a chain the
 * grant never authorised.
 */
export function grantClient(opts: GrantSignerOptions): x402Client {
  const net = getBaseNetwork(opts.chainId ?? DEFAULT_CHAIN_ID);
  return new x402Client().register(net.caip2, new ExactEvmScheme(createGrantSigner(opts)));
}

export async function payX402Base(opts: PayOptions): Promise<PayResult> {
  const client = grantClient(opts);
  const http = new x402HTTPClient(client);
  const response = await wrapFetchWithPayment(fetch, client)(opts.url, opts.init ?? { method: 'GET' });
  const result = await http.processResponse(response);
  return {
    status: response.status,
    body: result.body,
    paymentStatus: result.paymentStatus,
    settlement: result.header,
  };
}
