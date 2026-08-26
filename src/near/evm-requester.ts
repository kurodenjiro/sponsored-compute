/**
 * The `EvmSignatureRequester` that `src/base/pay.ts` expects, backed by
 * `grant-manager.near`.
 *
 * This is the join between the two legs: the x402 SDK asks our signer for an
 * EIP-712 signature, and the signer asks the contract, which re-checks the caps
 * against its own state and only then reaches the MPC signer. No private key
 * exists on this path at any point.
 *
 * Note what is *not* sent: the digest. The contract takes the fields and builds
 * the digest itself, so a compromised client cannot get a signature over
 * anything the caps did not allow (docs/TASKS-NEAR.md §3, prohibition 4).
 */

import type { EvmSignatureRequester } from '../base/pay.js';
import { loadNearAgent, type NearAgent } from './signer.js';
import { requireGrantManager } from './config.js';

/**
 * `request_evm_signature` fans out to the MPC signer and back through a
 * callback, so it needs room for the whole round trip.
 *
 * ⚠️ This number is charged against the grant key's `allowance` as **prepaid**
 * gas, whether or not the call succeeds. Raising it does not buy safety — it
 * shortens the life of every grant issued under the campaign. See the note on
 * `key_allowance` in contract-near/src/lib.rs.
 */
const GAS_REQUEST_SIGNATURE = 220_000_000_000_000n;

export interface ContractRequesterOptions {
  agent?: NearAgent;
  networkId?: string;
  grantManager?: string;
}

export async function contractSignatureRequester(
  opts: ContractRequesterOptions = {},
): Promise<EvmSignatureRequester> {
  const agent = opts.agent ?? (await loadNearAgent({ networkId: opts.networkId, quiet: true }));
  const contractId = opts.grantManager ?? requireGrantManager(opts.networkId);

  return {
    async requestSignature({ to, amount, validBefore, nonce }) {
      // `callFunction` is typed for JSON scalars; this method also returns null
      // when the signing round failed.
      const signature = (await agent.account.callFunction<string>({
        contractId,
        methodName: 'request_evm_signature',
        args: {
          to,
          amount: amount.toString(),
          // The contract works in nanoseconds; EIP-3009 validBefore is seconds.
          valid_before: (validBefore * 1_000_000_000n).toString(),
          nonce,
        },
        gas: GAS_REQUEST_SIGNATURE,
      })) as string | null;

      if (!signature) {
        // The contract already released the reservation, so the budget is intact
        // and retrying is safe.
        throw new Error(
          'grant-manager could not obtain a signature from the MPC signer; the reservation was released',
        );
      }
      return signature as `0x${string}`;
    },
  };
}
