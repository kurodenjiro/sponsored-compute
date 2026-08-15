/**
 * Regression tests for the agent key source.
 *
 * These exist because unwrap.agentKey() used to read the OS keychain directly
 * while the signer also accepted a file fallback. On a host without a keychain
 * the signer minted a wallet into the fallback file and reported the project as
 * claimable, then every on-chain write failed with "no agent key in keychain"
 * even though the wallet plainly existed. Both paths must resolve through one
 * function, and creating a key must stay opt-in.
 *
 * Run: npx tsx src/signer.test.ts
 *
 * AGENT_PRIVATE_KEY is set before importing so the tests never touch the real
 * keychain or write a wallet file on the machine running them.
 */

// Only dynamic imports below (the env var must be set first), so mark this a
// module explicitly — otherwise top-level await is a compile error.
export {};

const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const TEST_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

process.env.AGENT_PRIVATE_KEY = TEST_KEY;

const { agentPrivateKey, agentAddress } = await import('./signer.js');
const { agentKey } = await import('./unwrap.js');

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  → got ${String(got)}, want ${String(want)}`}`);
}

// The env key wins over any store, so a CI run never depends on host state.
{
  const found = await agentPrivateKey();
  check('agentPrivateKey honours AGENT_PRIVATE_KEY', found?.pk, TEST_KEY);
  check('env key is not reported as newly created', found?.created, false);
  check('env key reports its source', found?.kind, 'env');
}

/**
 * The invariant that broke: the signer and the on-chain write path must agree
 * on which key they are using. If these ever diverge again, claim/pay/unwrap
 * silently operate as a different wallet than the one shown to the user.
 */
{
  const fromSigner = await agentPrivateKey();
  const fromWritePath = await agentKey();
  check('agentKey resolves through the same source as the signer', fromWritePath, fromSigner?.pk);
  check('agentAddress derives from that same key', await agentAddress(), TEST_ADDRESS);
}

// Creating a key is a side effect on the user's machine: opt-in, never implied.
{
  const readOnly = await agentPrivateKey({ create: false });
  check('create:false still resolves an existing key', readOnly?.pk, TEST_KEY);
  check('create:false never reports a creation', readOnly?.created, false);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
