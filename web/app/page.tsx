/**
 * Landing page.
 *
 * The Avalanche walkthrough that lived here was removed with the XSGD/AVAX
 * layer on 26/08/2026. The NEAR + Base console is rebuilt in Wave 3
 * (docs/TASKS-NEAR.md §8) on NEAR Wallet Selector; this placeholder keeps the
 * app shell and the design tokens alive without claiming a flow that no longer
 * exists behind it.
 */

export default function Home() {
  return (
    <main className="app-content">
      <p className="eyebrow">REPO-NATIVE GRANTS · USDC · NEAR + BASE · x402</p>
      <h1>Purpose-bound infrastructure credit, spent by an AI agent.</h1>
      <p>
        A sponsor funds a campaign on NEAR. A developer&apos;s agent claims a grant bound to their
        repository, then pays a real x402 merchant on Base from an address the NEAR contract
        controls. The sponsor deletes one access key and both legs stop.
      </p>
      <p>
        The contract is live on testnet at <code>gm.anyone3-pay.testnet</code>. Until the console
        lands, the working surface is the CLI: <code>npm run near:spike</code> runs the whole flow
        end to end, and <code>npm run near:agent -- status &lt;campaign&gt; &lt;repo&gt;</code> reads a
        grant.
      </p>
    </main>
  );
}
