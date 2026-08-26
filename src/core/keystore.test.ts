/**
 * Regression tests for the agent key source.
 *
 * These exist because the EVM signer and the on-chain write path once resolved
 * keys through two different functions: on a host without an OS keychain the
 * signer minted a wallet into the fallback file and reported the project as
 * claimable, then every write failed with "no key in keychain" even though the
 * wallet plainly existed. One function, one answer — and creating a key stays
 * opt-in, because it writes permanently to the user's machine.
 *
 * Ported to the NEAR key when the Avalanche EOA path was removed.
 * Run: npx tsx src/core/keystore.test.ts
 *
 * The env var is set before importing so the tests never touch the real keychain
 * or write a key file on the machine running them. The key below is a throwaway
 * generated for this file and is not used on any network.
 */

export {};

const TEST_SECRET = 'ed25519:B4CDjv7ZPU2BMccQwt6thmV16YvMFZxDuP2m55ExDCd629mFztvZn24sVjZcJuEWXBB8t9UPwyt7c7YdNnEqPE9';
const TEST_PUBLIC = 'ed25519:7Eua7ZndtiMEnVWtjPdimhi5nXomjZLLovkVMYy2axqo';

process.env.AGENT_NEAR_SECRET_KEY = TEST_SECRET;

const { loadSecret } = await import('./keystore.js');
const { agentPublicKey } = await import('../near/signer.js');

const SPEC = {
  service: 'sponsored-compute',
  account: 'agent-near',
  fallbackFile: 'near-agent.json',
  envVar: 'AGENT_NEAR_SECRET_KEY',
  generate: () => { throw new Error('tests must never mint a key'); },
};

let pass = 0, fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  → got ${String(got)}, want ${String(want)}`}`);
}

// The env key wins over any store, so a CI run never depends on host state.
{
  const found = await loadSecret(SPEC);
  check('loadSecret honours the env var', found?.secret, TEST_SECRET);
  check('env key is not reported as newly created', found?.created, false);
  check('env key reports its source', found?.kind, 'env');
}

/**
 * The invariant that broke before: everything that touches the key must resolve
 * through the same source, or the agent signs as a different identity than the
 * one shown to the user.
 */
{
  check('agentPublicKey derives from that same key', await agentPublicKey(), TEST_PUBLIC);
}

// Creating a key is a side effect on the user's machine: opt-in, never implied.
{
  const readOnly = await loadSecret(SPEC, { create: false });
  check('create:false still resolves an existing key', readOnly?.secret, TEST_SECRET);
  check('create:false never reports a creation', readOnly?.created, false);
}

// A store miss with create:false must be null, not a freshly minted key —
// SPEC.generate throws, so a regression here fails loudly instead of silently
// writing to the developer's keychain.
{
  const missing = await loadSecret({ ...SPEC, envVar: 'SPONSORED_NO_SUCH_ENV_VAR', account: 'agent-near-absent' }, { create: false });
  check('a missing key with create:false resolves to null', missing, null);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
