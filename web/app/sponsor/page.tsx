'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { avalancheFuji } from 'viem/chains';
import { createPublicClient, createWalletClient, custom, http, keccak256, parseUnits, stringToHex } from 'viem';

const RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const GRANT_MANAGER = '0x3230B5666d8De86d3079D07bb45A7075A1d0b043' as const;
const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
const zero = '0x0000000000000000000000000000000000000000' as const;
const registryAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'payToOf', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'payTo', type: 'address' }, { name: 'name', type: 'string' }, { name: 'category', type: 'bytes32' }], outputs: [] },
] as const;
const grantAbi = [
  { type: 'function', name: 'registry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'xsgd', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'createCampaign', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'c', type: 'tuple', components: [{ name: 'sponsor', type: 'address' }, { name: 'merchantId', type: 'bytes32' }, { name: 'funded', type: 'uint256' }, { name: 'committed', type: 'uint256' }, { name: 'grantAmount', type: 'uint256' }, { name: 'trancheCount', type: 'uint32' }, { name: 'tranchePeriod', type: 'uint32' }, { name: 'minSpendPerTranche', type: 'uint256' }, { name: 'minDaysPerTranche', type: 'uint32' }, { name: 'grantValidity', type: 'uint64' }, { name: 'perTxCap', type: 'uint256' }, { name: 'dailyCap', type: 'uint256' }, { name: 'attestor', type: 'address' }, { name: 'paused', type: 'bool' }] }], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'issueGrant', stateMutability: 'nonpayable', inputs: [{ name: 'campaignId', type: 'bytes32' }, { name: 'projectId', type: 'bytes32' }, { name: 'owner', type: 'address' }, { name: 'signer', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const erc20Abi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const;
const validAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

export default function SponsorPage() {
  const [merchant, setMerchant] = useState('SupaDB'); const [payTo, setPayTo] = useState('0xd077E3f3048AD97C50A08a31a95F4918278B31ac');
  const [campaignName, setCampaignName] = useState('SupaDB MVP credits'); const [projectName, setProjectName] = useState('MVP build'); const [grant, setGrant] = useState('2.00'); const [owner, setOwner] = useState(''); const [agent, setAgent] = useState('');
  const [wallet, setWallet] = useState(''); const [status, setStatus] = useState('Connect the owner wallet to prepare transactions.'); const [busy, setBusy] = useState(false);
  const [registryOwner, setRegistryOwner] = useState(''); const [registeredPayTo, setRegisteredPayTo] = useState(''); const [registryLoading, setRegistryLoading] = useState(true);
  const merchantId = useMemo(() => keccak256(stringToHex(merchant.toLowerCase().trim())), [merchant]);
  const campaign = useMemo(() => keccak256(stringToHex(`campaign:${merchantId}:${campaignName.trim().toLowerCase()}`)), [merchantId, campaignName]);
  const projectId = useMemo(() => keccak256(stringToHex(`project:${campaign}:${projectName.trim().toLowerCase()}`)), [campaign, projectName]);
  const ready = validAddress(payTo) && campaignName.trim().length >= 3 && Number(grant) > 0;
  const merchantAlreadyRegistered = registeredPayTo !== '' && registeredPayTo !== zero;
  const walletIsRegistryOwner = wallet !== '' && registryOwner !== '' && wallet.toLowerCase() === registryOwner.toLowerCase();
  useEffect(() => {
    let cancelled = false;
    const readRegistryState = async () => {
      setRegistryLoading(true);
      try {
        const registry = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'registry' });
        const [onChainOwner, existingPayTo] = await Promise.all([
          publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'owner' }),
          publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'payToOf', args: [merchantId] }),
        ]);
        if (!cancelled) { setRegistryOwner(onChainOwner); setRegisteredPayTo(existingPayTo); }
      } catch {
        if (!cancelled) setStatus('Unable to read Registry state. Check the Avalanche Fuji RPC connection.');
      } finally {
        if (!cancelled) setRegistryLoading(false);
      }
    };
    void readRegistryState();
    return () => { cancelled = true; };
  }, [merchantId]);
  const connectWallet = async () => {
    const ethereum = (window as typeof window & { ethereum?: any }).ethereum;
    if (!ethereum) return setStatus('Core or another EVM wallet was not detected. Install the Core wallet extension.');
    try {
      const client = createWalletClient({ chain: avalancheFuji, transport: custom(ethereum) });
      const [account] = await client.requestAddresses();
      if (!account) throw new Error('No wallet account selected.');
      await client.switchChain({ id: avalancheFuji.id });
      setWallet(account);
      setOwner((current) => current || account);
      setStatus(`Wallet connected: ${account.slice(0, 6)}…${account.slice(-4)} · Avalanche Fuji ready.`);
    } catch (error: any) {
      setStatus(`Wallet connection failed: ${error?.shortMessage ?? error?.message ?? 'request rejected'}`);
    }
  };
  const run = async (label: string, action: (account: `0x${string}`, client: ReturnType<typeof createWalletClient>) => Promise<`0x${string}` | void>) => {
    const ethereum = (window as typeof window & { ethereum?: unknown }).ethereum; if (!ethereum) return setStatus('No injected wallet found. Install or unlock Core, MetaMask, or another EVM wallet.');
    setBusy(true); try { const client = createWalletClient({ chain: avalancheFuji, transport: custom(ethereum as any) }); const [account] = await client.requestAddresses(); if (!account) throw new Error('No wallet account selected.'); setWallet(account); setStatus(`${label}: waiting for wallet signature…`); const hash = await action(account, client); if (hash) { setStatus(`${label}: submitted ${hash.slice(0, 10)}… — waiting for confirmation.`); await publicClient.waitForTransactionReceipt({ hash }); setStatus(`${label}: confirmed on Avalanche Fuji.`); } } catch (error: any) { setStatus(`${label}: ${error?.shortMessage ?? error?.message ?? 'transaction failed'}`); } finally { setBusy(false); }
  };
  const register = () => {
    if (merchantAlreadyRegistered) return setStatus(`${merchant} is already approved for ${registeredPayTo}. No transaction is needed.`);
    if (!walletIsRegistryOwner) return setStatus(`Merchant approval requires the Registry owner wallet (${registryOwner ? `${registryOwner.slice(0, 6)}…${registryOwner.slice(-4)}` : 'loading…'}). Connect that wallet or transfer Registry ownership first.`);
    return run('Merchant approval', async (account, client) => {
      const registry = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'registry' });
      return client.writeContract({ account, chain: avalancheFuji, address: registry, abi: registryAbi, functionName: 'register', args: [merchantId, payTo as `0x${string}`, merchant, keccak256(stringToHex('database'))] });
    });
  };
  const createCampaign = () => run('Campaign creation', async (account, client) => client.writeContract({ account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'createCampaign', args: [campaign as `0x${string}`, { sponsor: account, merchantId, funded: 0n, committed: 0n, grantAmount: parseUnits(grant, 6), trancheCount: 2, tranchePeriod: 86_400, minSpendPerTranche: 0n, minDaysPerTranche: 0, grantValidity: BigInt(30 * 86_400), perTxCap: parseUnits('0.50', 6), dailyCap: parseUnits('1.00', 6), attestor: zero, paused: false }] }));
  const fund = () => run('Campaign funding', async (account, client) => { const xsgd = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'xsgd' }); const amount = parseUnits(grant, 6); const approval = await client.writeContract({ account, chain: avalancheFuji, address: xsgd, abi: erc20Abi, functionName: 'approve', args: [GRANT_MANAGER, amount] }); await publicClient.waitForTransactionReceipt({ hash: approval }); return client.writeContract({ account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'fund', args: [campaign as `0x${string}`, amount] }); });
  const issue = () => {
    if (projectName.trim().length < 3) return setStatus('Grant issuance: enter a project name first.');
    return run('Grant issuance', async (account, client) => client.writeContract({ account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'issueGrant', args: [campaign, projectId, owner as `0x${string}`, agent as `0x${string}`] }));
  };
  return <main className="sponsor"><nav><Link href="/" className="brand">sponsored<span>compute</span></Link><Link href="/merchant">Merchant dashboard ↗</Link></nav><header><p>SPONSOR CONSOLE · OWNER-SIGNED ACTIONS</p><h1>Put XSGD where<br /><em>it can do the work.</em></h1><span>WALLET SIGNS → GRANTMANAGER ENFORCES → AGENT SPENDS EXACTLY</span></header><section className="steps">{[['01','Approve merchant','Register a verified recipient in the owner-controlled allowlist.'],['02','Create and fund','Set the campaign guardrails, then approve and fund XSGD.'],['03','Issue one Grant','Bind one project ID to one developer and agent signer.']].map((x) => <article key={x[0]}><b>{x[0]}</b><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</section><section className="board"><div><p>CAMPAIGN INPUTS</p><label>Merchant name<Input value={merchant} onChange={(e) => setMerchant(e.target.value)} /></label><label>Merchant payTo<Input value={payTo} onChange={(e) => setPayTo(e.target.value)} /></label><label>Campaign name<Input value={campaignName} placeholder="e.g. SupaDB MVP credits" onChange={(e) => setCampaignName(e.target.value)} /></label><small className="field-help">A unique on-chain ID is generated automatically from this name.</small><label>Project name<Input value={projectName} placeholder="e.g. MVP build" onChange={(e) => setProjectName(e.target.value)} /></label><small className="field-help">Used to create the developer Grant; its ID is also generated automatically.</small><label>Grant amount (XSGD)<Input value={grant} onChange={(e) => setGrant(e.target.value)} /></label><label>Developer reward wallet<Input value={owner} placeholder="Connect your wallet to fill this automatically" onChange={(e) => setOwner(e.target.value.trim())} /></label><small className="field-help">Owns the Grant and receives the earned reward.</small><label>Agent signing wallet<Input value={agent} placeholder="A separate wallet used by your MCP agent" onChange={(e) => setAgent(e.target.value.trim())} /></label><small className="field-help">Can sign within campaign limits; it never owns your funds.</small></div><div className="actions"><p>ON-CHAIN EXECUTION</p><code>merchantId {merchantId.slice(0, 12)}…</code><code>campaignId {campaign.slice(0, 12)}…</code><code>projectId {projectId.slice(0, 12)}…</code><small className="registry-state">{registryLoading ? "Checking Registry…" : merchantAlreadyRegistered ? "Merchant already approved" : walletIsRegistryOwner ? "Registry owner connected" : "Connect the Registry owner wallet"}</small><small className="registry-owner">{registryOwner ? <>Registry owner {registryOwner.slice(0, 6)}…{registryOwner.slice(-4)}</> : "Registry owner loading…"}</small><Button className="connect-wallet" disabled={busy} onClick={connectWallet}>{wallet ? "Connected" : "Connect Core / EVM wallet"}</Button><small>{wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'No wallet connected'}</small><Button disabled={busy || registryLoading || merchantAlreadyRegistered || !walletIsRegistryOwner || !validAddress(payTo)} onClick={register}>{merchantAlreadyRegistered ? "01 · Merchant approved" : walletIsRegistryOwner ? "01 · Approve merchant" : "01 · Owner wallet required"}</Button><Button disabled={busy || !ready} onClick={createCampaign}>02 · Create campaign</Button><Button disabled={busy || !ready} onClick={fund}>03 · Approve & fund XSGD</Button><Button disabled={busy || !ready || projectName.trim().length < 3 || !validAddress(owner) || !validAddress(agent)} onClick={issue}>04 · Issue Grant</Button><aside>{status}</aside><small>Each button requires an explicit wallet signature. This website never receives a private key.</small></div></section><style jsx>{`:global(body){margin:0;background:#0d0f0b;color:#f4f6ed;font-family:'Helvetica Neue',Helvetica,sans-serif}.sponsor{min-height:100vh;padding:0 4.5vw 90px;background:radial-gradient(ellipse 72% 42% at 50% 0%,#21331c 0%,#0d0f0b 68%)}nav{height:76px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #354031;font:11px ui-monospace,monospace;letter-spacing:.08em}nav a{color:#c8ff45;text-decoration:none}.brand{font:800 17px 'Helvetica Neue';letter-spacing:-.07em;color:#f4f6ed!important}.brand span,header p,.board p{color:#c8ff45}header{padding:90px 0 60px}header p,.board p{font:700 11px ui-monospace,monospace;letter-spacing:.12em}header h1{font-size:clamp(54px,8vw,108px);line-height:.82;letter-spacing:-.08em;margin:18px 0 30px}header em{font-style:normal;color:#c8ff45}header>span{color:#c8ff45;font:10px ui-monospace,monospace}.steps{display:grid;grid-template-columns:repeat(3,1fr);border-block:1px solid #394233}.steps article{padding:28px 28px 28px 0;margin-right:28px;border-right:1px solid #394233}.steps article:last-child{border:0}.steps b{color:#c8ff45;font:13px ui-monospace,monospace}.steps h2{font-size:25px;letter-spacing:-.04em}.steps p{color:#aeb8a8;line-height:1.5}.board{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#3d4738;border:1px solid #3d4738;margin-top:58px}.board>div{background:#151a13;padding:30px}.board label{display:block;color:#aeb8a8;font:11px ui-monospace,monospace;letter-spacing:.05em;margin:0 0 18px}.board input{display:block;width:100%;margin-top:8px;padding:13px;background:#0e120d;border:1px solid #46523e;color:#f4f6ed;font:13px ui-monospace,monospace;outline:none}.board input:focus{border-color:#c8ff45;box-shadow:0 0 0 3px #c8ff4522}.actions{display:grid;align-content:start;gap:11px}.actions code,.actions small{color:#aeb8a8;font:11px ui-monospace,monospace}.actions button{padding:14px;text-align:left;border:1px solid #506044;background:#202a1b;color:#f4f6ed;cursor:pointer;font:700 13px ui-monospace,monospace}.actions button:hover:not(:disabled){background:#c8ff45;color:#10140d}.actions button:disabled{opacity:.45;cursor:not-allowed}.actions aside{margin:12px 0;padding:13px;border-left:3px solid #c8ff45;background:#20291a;color:#dce9d1;line-height:1.5;font-size:13px}@media(max-width:720px){.steps,.board{grid-template-columns:1fr}.steps article{border-right:0;border-bottom:1px solid #394233;margin-right:0}.sponsor{padding-inline:20px}.board{margin-top:35px}}`}</style></main>;
}
