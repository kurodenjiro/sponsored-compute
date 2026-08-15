'use client';

/**
 * Sponsor console — luồng: DÁN REPO → FUND → NHẬN CHUỖI CÀI VÀO REPO.
 *
 * Sponsor KHÔNG nhập ví developer ở đây: lúc fund thì chưa biết ai sẽ build.
 * Grant phát ra lúc dev claim (MCP gọi issueGrant, xem src/claim.ts), mỗi ví
 * một projectId. Vì vậy trang này dừng lại ở bước đăng ký repo.
 *
 * Giao diện chỉ có MỘT nút chính. Bước tiếp theo suy ra từ trạng thái on-chain
 * chứ không bắt người dùng tự đoán thứ tự — dán repo đã được tài trợ sẵn thì
 * ra thẳng chuỗi cài, không ký gì cả.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SiteNav } from '../../components/site-nav';
import { avalancheFuji } from 'viem/chains';
import { createPublicClient, createWalletClient, custom, http, parseUnits } from 'viem';
import { campaignIdOf, capsFor, formatAmount, merchantIdOf, parseRepoUrl, sponsorSlugOf, type RepoRef } from '../../../src/campaign.js';

const RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const CHAIN_ID = 43113;
const GRANT_MANAGER = '0xbd1ffd89b634810fe09069312d618641f43d9814' as const;
const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });
const zero = '0x0000000000000000000000000000000000000000' as const;
// Trang này chỉ ĐỌC Registry. Việc ghi (register) do server ký — xem
// api/registry/merchant/route.ts — nên không có ABI ghi ở phía client.
const registryAbi = [
  { type: 'function', name: 'payToOf', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ type: 'address' }] },
] as const;
const campaignTuple = [
  { name: 'sponsor', type: 'address' }, { name: 'merchantId', type: 'bytes32' }, { name: 'funded', type: 'uint256' },
  { name: 'committed', type: 'uint256' }, { name: 'grantAmount', type: 'uint256' }, { name: 'trancheCount', type: 'uint32' },
  { name: 'tranchePeriod', type: 'uint32' }, { name: 'minSpendPerTranche', type: 'uint256' }, { name: 'minDaysPerTranche', type: 'uint32' },
  { name: 'grantValidity', type: 'uint64' }, { name: 'perTxCap', type: 'uint256' }, { name: 'dailyCap', type: 'uint256' },
  { name: 'attestor', type: 'address' }, { name: 'paused', type: 'bool' }, { name: 'asset', type: 'uint8' },
] as const;
const grantAbi = [
  { type: 'function', name: 'registry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'xsgd', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'campaigns', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: campaignTuple },
  { type: 'function', name: 'createCampaign', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'c', type: 'tuple', components: campaignTuple }], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'fundAvax', stateMutability: 'payable', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [] },
] as const;
const erc20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;

type Asset = 0 | 1;
const assetMeta = (asset: Asset) => asset === 1
  ? { symbol: 'AVAX', decimals: 18, mode: 'Native gas grant' }
  : { symbol: 'XSGD', decimals: 6, mode: 'x402 payment grant' };
const GRANT_PRESETS: Record<Asset, string[]> = { 0: ['0.10', '1.00', '2.00', '10.00'], 1: ['0.01', '0.02', '0.05', '0.10'] };
const SEAT_PRESETS = ['1', '3', '10'];

type Chain = {
  loading: boolean;
  merchantPayTo: string;
  exists: boolean;
  paused: boolean;
  /** funded − committed: phần còn phát Grant được */
  available: bigint;
  /** Cỡ Grant đã CỐ ĐỊNH lúc tạo campaign; sửa ở form không đổi được nữa. */
  grantAmount: bigint;
  asset: Asset;
};
const emptyChain: Chain = { loading: true, merchantPayTo: '', exists: false, paused: false, available: 0n, grantAmount: 0n, asset: 0 };

export default function SponsorPage() {
  const [repoUrl, setRepoUrl] = useState('https://github.com/supadb/supadb-starter');
  const [debouncedUrl, setDebouncedUrl] = useState(repoUrl);
  const [grant, setGrant] = useState('2.00');
  const [asset, setAsset] = useState<Asset>(0);
  const [seats, setSeats] = useState('3');
  const [wallet, setWallet] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [chain, setChain] = useState<Chain>(emptyChain);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ install: string; manifest: string; mcp: string; codex: string; seats: number; repo: string } | null>(null);
  const [copied, setCopied] = useState('');

  // Gõ URL không nên bắn RPC mỗi phím.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedUrl(repoUrl), 400);
    return () => window.clearTimeout(timer);
  }, [repoUrl]);

  const parsed = useMemo(() => {
    try {
      return { repo: parseRepoUrl(debouncedUrl), error: '' };
    } catch (e: any) {
      return { repo: null as RepoRef | null, error: e?.message ?? 'Invalid repository URL' };
    }
  }, [debouncedUrl]);
  const repo = parsed.repo;
  const sponsor = repo ? sponsorSlugOf(repo) : '';
  const merchantId = useMemo(() => (repo ? merchantIdOf(sponsor) : zero), [repo, sponsor]);
  const campaignId = useMemo(() => (repo ? campaignIdOf(repo, sponsor) : zero), [repo, sponsor]);
  const effectiveAsset: Asset = chain.exists ? chain.asset : asset;
  const meta = assetMeta(effectiveAsset);
  const displayAmount = useCallback((value: bigint) => `${formatAmount(value, meta.decimals)} ${meta.symbol}`, [meta.decimals, meta.symbol]);

  const typedGrant = useMemo(() => {
    try { return parseUnits(grant || '0', meta.decimals); } catch { return 0n; }
  }, [grant, meta.decimals]);
  // Campaign đã tồn tại → cỡ Grant do chain quyết, ô nhập chỉ còn là ghi chú.
  const grantAtomic = chain.exists ? chain.grantAmount : typedGrant;
  const seatCount = Math.max(1, Math.min(1000, Number(seats) || 1));
  const poolAtomic = grantAtomic * BigInt(seatCount);
  const caps = capsFor(grantAtomic);
  const seatsLeft = grantAtomic > 0n ? Number(chain.available / grantAtomic) : 0;
  const merchantApproved = effectiveAsset === 1 || (chain.merchantPayTo !== '' && chain.merchantPayTo !== zero);
  const shortOfFunds = balance !== null && balance < poolAtomic;

  // Repo đã đủ tiền thì ai cũng lấy được chuỗi cài — bước này không ký gì nên
  // không có lý do bắt kết nối ví. Ví chỉ cần cho hai bước tiêu tiền.
  const stage: 'repo' | 'wallet' | 'create' | 'fund' | 'ready' =
    !repo || grantAtomic === 0n ? 'repo'
      : chain.exists && seatsLeft >= 1 ? 'ready'
        : !wallet ? 'wallet'
          : !chain.exists ? 'create'
            : 'fund';

  const readChain = useCallback(async () => {
    if (!repo) return;
    setChain((c) => ({ ...c, loading: true }));
    try {
      const registry = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'registry' });
      const [payTo, campaign] = await Promise.all([
        publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'payToOf', args: [merchantId] }),
        publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'campaigns', args: [campaignId] }),
      ]);
      setChain({
        loading: false, merchantPayTo: payTo,
        exists: campaign[0] !== zero, paused: campaign[13],
        available: campaign[2] - campaign[3], grantAmount: campaign[4], asset: campaign[14] === 1 ? 1 : 0,
      });
    } catch {
      setChain((c) => ({ ...c, loading: false }));
      setStatus('Could not read Fuji state. Check the Avalanche RPC connection.');
    }
  }, [repo, merchantId, campaignId]);

  useEffect(() => { setResult(null); void readChain(); }, [readChain]);

  const readBalance = useCallback(async (account: string) => {
    try {
      if (effectiveAsset === 1) {
        setBalance(await publicClient.getBalance({ address: account as `0x${string}` }));
        return;
      }
      const xsgd = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'xsgd' });
      setBalance(await publicClient.readContract({ address: xsgd, abi: erc20Abi, functionName: 'balanceOf', args: [account as `0x${string}`] }));
    } catch { setBalance(null); }
  }, [effectiveAsset]);

  useEffect(() => { if (wallet) void readBalance(wallet); }, [wallet, readBalance]);

  const connectWallet = async () => {
    const ethereum = (window as typeof window & { ethereum?: any }).ethereum;
    if (!ethereum) return setStatus('No Core or other EVM wallet detected. Install the Core extension and try again.');
    setBusy(true);
    try {
      const client = createWalletClient({ chain: avalancheFuji, transport: custom(ethereum) });
      const [account] = await client.requestAddresses();
      if (!account) throw new Error('No wallet account selected.');
      await client.switchChain({ id: avalancheFuji.id });
      setWallet(account);
      void readBalance(account);
      setStatus(`Wallet ${short(account)} connected — it owns and funds this ${meta.symbol} campaign.`);
    } catch (error: any) {
      setStatus(`Wallet connection failed: ${error?.shortMessage ?? error?.message ?? 'request rejected'}`);
    } finally { setBusy(false); }
  };

  const run = async (label: string, action: (account: `0x${string}`, client: ReturnType<typeof createWalletClient>) => Promise<`0x${string}` | void>) => {
    const ethereum = (window as typeof window & { ethereum?: unknown }).ethereum;
    if (!ethereum) return setStatus('No injected wallet found. Unlock Core, MetaMask, or another EVM wallet.');
    setBusy(true);
    try {
      const client = createWalletClient({ chain: avalancheFuji, transport: custom(ethereum as any) });
      const [account] = await client.requestAddresses();
      if (!account) throw new Error('No wallet account selected.');
      setWallet(account);
      setStatus(`${label}: waiting for signature…`);
      const hash = await action(account, client);
      if (hash) {
        setStatus(`${label}: submitted ${hash.slice(0, 10)}… — waiting for confirmation.`);
        await publicClient.waitForTransactionReceipt({ hash });
        setStatus(`${label}: confirmed on Avalanche Fuji.`);
      }
      await Promise.all([readChain(), readBalance(account)]);
      return true;
    } catch (error: any) {
      setStatus(`${label}: ${error?.shortMessage ?? error?.message ?? 'transaction failed'}`);
      return false;
    } finally { setBusy(false); }
  };

  /**
   * Duyệt merchant do SERVER ký bằng khoá chủ Registry (xem api/registry/merchant).
   * Sponsor không phải là chủ Registry, nên nếu bắt họ tự ký thì mọi repo lạ đều
   * kẹt ở đây. Đổi lại: allowlist không còn kiểm duyệt — chấp nhận để demo chạy.
   */
  const ensureMerchant = async (payTo: string) => {
    if (merchantApproved) return true;
    setStatus('Auto-approving merchant…');
    try {
      const response = await fetch('/api/registry/merchant', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoUrl: repo?.url, sponsor, payTo, chainId: CHAIN_ID }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setChain((c) => ({ ...c, merchantPayTo: data.payTo }));
      return true;
    } catch (error: any) {
      setStatus(`Merchant approval: ${error?.message ?? 'failed'}`);
      return false;
    }
  };

  const createCampaign = () => run('Create campaign', async (account, client) => client.writeContract({
    account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'createCampaign',
    args: [campaignId, {
      sponsor: account, merchantId, funded: 0n, committed: 0n,
      grantAmount: grantAtomic, trancheCount: 2, tranchePeriod: 86_400,
      minSpendPerTranche: 0n, minDaysPerTranche: 0, grantValidity: BigInt(30 * 86_400),
      perTxCap: caps.perTxCap, dailyCap: caps.dailyCap, attestor: zero, paused: false,
      asset: effectiveAsset,
    }],
  }));

  const fundCampaign = () => run(`Fund ${displayAmount(poolAtomic)}`, async (account, client) => {
    if (effectiveAsset === 1) {
      setStatus(`Funding ${displayAmount(poolAtomic)} as native AVAX…`);
      return client.writeContract({ account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'fundAvax', args: [campaignId], value: poolAtomic });
    }
    const xsgd = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'xsgd' });
    setStatus('Step 1/2 — approving XSGD for GrantManager…');
    const approval = await client.writeContract({ account, chain: avalancheFuji, address: xsgd, abi: erc20Abi, functionName: 'approve', args: [GRANT_MANAGER, poolAtomic] });
    await publicClient.waitForTransactionReceipt({ hash: approval });
    setStatus('Step 2/2 — funding the campaign…');
    return client.writeContract({ account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'fund', args: [campaignId, poolAtomic] });
  });

  /** Không ký gì: registry đọc lại chain rồi mới trả chuỗi cài. */
  const registerRepo = useCallback(async () => {
    if (!repo) return;
    setBusy(true);
    setStatus('Registering the repository with Sponsored Compute…');
    try {
      const response = await fetch('/api/registry', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoUrl: repo.url, sponsor, chainId: CHAIN_ID, campaignId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setResult({
        install: data.install,
        manifest: JSON.stringify(data.manifest, null, 2),
        mcp: JSON.stringify(data.mcp, null, 2),
        codex: data.codex,
        seats: data.seats,
        repo: repo.slug,
      });
      setStatus(`${repo.slug} is live. Paste the command below into the repository — that is all a developer needs.`);
    } catch (error: any) {
      setStatus(`Repository registration: ${error?.message ?? 'failed'}`);
    } finally { setBusy(false); }
  }, [repo, sponsor, campaignId]);

  /** Merchant phải nằm trong allowlist trước khi Grant tiêu được, nên duyệt luôn ở đây. */
  const approveThenCreate = async () => {
    if (effectiveAsset === 1) return createCampaign();
    setBusy(true);
    const ok = await ensureMerchant(wallet);
    setBusy(false);
    if (ok) await createCampaign();
  };

  /** Nạp xong là đủ điều kiện — không bắt bấm thêm một nút nữa. */
  const fundThenRegister = async () => { if (await fundCampaign()) await registerRepo(); };

  const primary: Record<typeof stage, { label: string; action: () => void; hint: string }> = {
    repo: { label: 'Enter a valid repo and amount', action: () => {}, hint: parsed.error || `${meta.symbol} per developer must be greater than 0.` },
    wallet: { label: 'Connect a wallet to continue', action: connectWallet, hint: `This wallet owns and funds the ${meta.symbol} campaign.` },
    create: { label: `Create ${meta.symbol} campaign for ${repo?.slug ?? ''}`, action: approveThenCreate, hint: `${meta.mode} · ${displayAmount(grantAtomic)} per developer. Asset and Grant size are locked permanently on creation.${effectiveAsset === 0 && !merchantApproved ? ' The merchant is auto-approved.' : ''}` },
    fund: { label: `${effectiveAsset === 0 ? 'Approve & fund' : 'Fund'} ${displayAmount(poolAtomic)}`, action: fundThenRegister, hint: `${seatCount} seat${seatCount === 1 ? '' : 's'} × ${displayAmount(grantAtomic)}. ${effectiveAsset === 0 ? 'Two signatures: approve, then fund.' : 'One payable transaction; no ERC-20 approval.'} The install command follows automatically.` },
    ready: { label: 'Get the repo install command', action: registerRepo, hint: 'Signs nothing — just re-reads the campaign on-chain and generates the command.' },
  };
  const steps = [
    { key: 'wallet', n: '01', label: 'Wallet', done: Boolean(wallet) },
    { key: 'create', n: '02', label: 'Campaign', done: chain.exists },
    { key: 'fund', n: '03', label: `Fund ${meta.symbol}`, done: chain.exists && seatsLeft >= 1 },
    { key: 'ready', n: '04', label: 'Install command', done: Boolean(result) },
  ];

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1_800);
    } catch { /* No clipboard permission: the text stays selectable for manual copy. */ }
  };

  return <main className="sponsor">
    <SiteNav />
    <header>
      <p>SPONSOR CONSOLE · ONE BUTTON AT A TIME</p>
      <h1>Fund a repo.<br /><em>Not a wallet.</em></h1>
      <span>PASTE A REPO → CHOOSE XSGD OR AVAX → FUND → SHIP THE POINTER</span>
    </header>

    <section className="board">
      <div className="form">
        <p>CAMPAIGN</p>
        <label htmlFor="repo">GitHub repo</label>
        <Input id="repo" value={repoUrl} placeholder="https://github.com/owner/repo" onChange={(e) => setRepoUrl(e.target.value)} />
        <small className={parsed.error ? 'field-error' : 'field-help'}>
          {parsed.error || <>sponsor <b>{sponsor}</b> · campaign derived from <b>{repo?.host}/{repo?.slug}</b></>}
        </small>

        <label>Campaign asset{chain.exists && <em className="locked">locked on-chain</em>}</label>
        <div className="asset-picker">
          <button type="button" disabled={chain.exists} className={effectiveAsset === 0 ? 'on xsgd' : ''} onClick={() => { setAsset(0); setGrant('2.00'); }}><b>XSGD</b><span>x402 merchant payments</span></button>
          <button type="button" disabled={chain.exists} className={effectiveAsset === 1 ? 'on avax' : ''} onClick={() => { setAsset(1); setGrant('0.02'); }}><b>AVAX</b><span>native agent gas</span></button>
        </div>
        <small className="field-help">One campaign uses exactly one asset. It cannot be switched after creation.</small>

        <label htmlFor="grant">{meta.symbol} per developer{chain.exists && <em className="locked">locked on-chain</em>}</label>
        <Input id="grant" value={chain.exists ? formatAmount(chain.grantAmount, meta.decimals) : grant} disabled={chain.exists} onChange={(e) => setGrant(e.target.value)} />
        {!chain.exists && <div className="chips">{GRANT_PRESETS[effectiveAsset].map((v) => <button key={v} className={grant === v ? 'on' : ''} onClick={() => setGrant(v)}>{v}</button>)}</div>}
        <small className="field-help">
          {chain.exists
            ? 'The campaign already exists, so the Grant size can no longer change — create a different repo for a different amount.'
            : 'Each developer claims exactly this much, released across 2 tranches.'}
        </small>

        <label htmlFor="seats">Seats to fund</label>
        <Input id="seats" value={seats} onChange={(e) => setSeats(e.target.value)} />
        <div className="chips">{SEAT_PRESETS.map((v) => <button key={v} className={seats === v ? 'on' : ''} onClick={() => setSeats(v)}>{v}</button>)}</div>
        <small className="field-help">About to fund: <b>{displayAmount(poolAtomic)}</b> = {displayAmount(grantAtomic)} × {seatCount}</small>

        <div className="derived">
          <span>grant mode</span><b>{meta.mode}</b>
          <span>per-action cap</span><b>{displayAmount(caps.perTxCap)}</b>
          <span>daily cap</span><b>{displayAmount(caps.dailyCap)}</b>
          <span>Grant validity</span><b>30 days</b>
          <span>{effectiveAsset === 0 ? 'merchant payTo' : 'gas recipient'}</span><b>{effectiveAsset === 1 ? 'developer agent signer' : merchantApproved ? short(chain.merchantPayTo) : wallet ? short(wallet) : 'wallet will connect'}</b>
        </div>
        <small className="field-help">Developer and agent wallets are not entered here. A developer binds their own wallet when they claim.</small>
      </div>

      <div className="panel">
        <div className="rail">{steps.map((s) => <div key={s.key} className={`rail-step ${s.done ? 'done' : stage === s.key ? 'now' : ''}`}><b>{s.done ? '✓' : s.n}</b><span>{s.label}</span></div>)}</div>

        <div className="live">
          <span>repo status</span>
          <b>{chain.loading ? 'reading Fuji…' : !repo ? '—' : chain.paused ? 'campaign is paused' : chain.exists ? `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left · ${displayAmount(chain.available)}` : `no ${meta.symbol} campaign yet`}</b>
          <span>wallet</span>
          <b>{wallet ? `${short(wallet)}${balance === null ? '' : ` · ${displayAmount(balance)}`}` : 'not connected'}</b>
          <span>asset mode</span>
          <b>{meta.mode}{effectiveAsset === 0 && merchantApproved && chain.merchantPayTo !== zero ? ` · ${short(chain.merchantPayTo)}` : ''}</b>
        </div>

        {/* The result must appear right where the button was clicked — no scrolling to find it. */}
        {result ? <div className="result">
          <header><span>RUN THIS IN THE REPO</span><button onClick={() => copy('install', result.install)}>{copied === 'install' ? 'Copied ✓' : 'Copy'}</button></header>
          <pre>{result.install}</pre>
          <footer>
            <b>{result.seats}</b> seat{result.seats === 1 ? '' : 's'} funded right now · <button className="link" onClick={() => document.getElementById('handoff')?.scrollIntoView({ behavior: 'smooth' })}>see sponsored.json and next steps ↓</button>
          </footer>
        </div> : <>
          <Button className="cta" disabled={busy || stage === 'repo' || chain.loading || (stage === 'fund' && shortOfFunds)} onClick={primary[stage].action}>
            {busy ? 'working…' : primary[stage].label}
          </Button>
          <small className="cta-hint">{stage === 'fund' && shortOfFunds ? `Wallet only has ${displayAmount(balance!)} — short ${displayAmount(poolAtomic - balance!)}. Reduce the seat count or top up ${meta.symbol}.` : primary[stage].hint}</small>
        </>}

        {status && <aside>{status}</aside>}

        <details>
          <summary>On-chain details</summary>
          <div className="ids">
            <span>merchantId</span><code>{merchantId}</code>
            <span>campaignId</span><code>{campaignId}</code>
            <span>GrantManager</span><code>{GRANT_MANAGER}</code>
            <span>chain</span><code>avalanche-fuji / {CHAIN_ID}</code>
            <span>asset</span><code>{meta.symbol} · {effectiveAsset}</code>
          </div>
          <div className="manual">
            <Button disabled={busy || effectiveAsset === 1 || !repo || merchantApproved || !wallet} onClick={() => ensureMerchant(wallet)}>Just approve XSGD merchant (server-signed)</Button>
            <Button disabled={busy || !repo || chain.exists} onClick={createCampaign}>Just create campaign</Button>
            <Button disabled={busy || !chain.exists} onClick={fundCampaign}>Just fund {displayAmount(poolAtomic)}</Button>
            <Button disabled={busy || !chain.exists} onClick={registerRepo}>Just get the install command</Button>
          </div>
          <small>Each button is its own wallet signature. This website never receives a private key.</small>
        </details>
      </div>
    </section>

    {result && <section className="handoff" id="handoff">
      <div>
        <p>WHAT GOES IN THE REPO</p>
        <h2>One line.<br />No secrets.</h2>
        <p className="muted">Run it in the root of <code>{result.repo}</code>, then commit <code>sponsored.json</code>, <code>.mcp.json</code>, and <code>.codex/config.toml</code>. It only writes pointers: no key, no wallet address, no contract address. <b>{result.seats}</b> seat{result.seats === 1 ? '' : 's'} are funded right now.</p>
      </div>
      <div className="handoff-card">
        <header><span>1 · RUN IN THE REPO</span><button onClick={() => copy('install', result.install)}>{copied === 'install' ? 'Copied ✓' : 'Copy'}</button></header>
        <pre>{result.install}</pre>
        <header><span>2 · IT WRITES sponsored.json</span><button onClick={() => copy('manifest', result.manifest)}>{copied === 'manifest' ? 'Copied ✓' : 'Copy'}</button></header>
        <pre>{result.manifest}</pre>
        <header><span>3 · .mcp.json — CLAUDE CODE PICKS THIS UP</span><button onClick={() => copy('mcp', result.mcp)}>{copied === 'mcp' ? 'Copied ✓' : 'Copy'}</button></header>
        <pre>{result.mcp}</pre>
        <header><span>4 · .codex/config.toml — CODEX PICKS THIS UP</span><button onClick={() => copy('codex', result.codex)}>{copied === 'codex' ? 'Copied ✓' : 'Copy'}</button></header>
        <pre>{result.codex}</pre>
        <footer>Developer side: clone the repo, open Claude Code or Codex CLI, and ask "does this project have sponsorship?". The MCP verifies the campaign on-chain, then issues that developer their own Grant.</footer>
      </div>
    </section>}

    <style jsx>{`:global(body){margin:0;background:#0d0f0b;color:#f4f6ed;font-family:'Helvetica Neue',Helvetica,sans-serif}.sponsor{min-height:100vh;padding:0 4.5vw 90px;background:radial-gradient(ellipse 72% 42% at 50% 0%,#21331c 0%,#0d0f0b 68%)}header p,.form>p,.handoff p:first-child{color:#c8ff45}header{padding:82px 0 54px}header p,.form>p,.handoff p:first-child{font:700 11px ui-monospace,monospace;letter-spacing:.12em}header h1{font-size:clamp(50px,7.5vw,96px);line-height:.82;letter-spacing:-.08em;margin:16px 0 26px}header em,.handoff em{font-style:normal;color:#c8ff45}header>span{color:#c8ff45;font:10px ui-monospace,monospace}
.board{display:grid;grid-template-columns:1fr .9fr;gap:1px;background:#3d4738;border:1px solid #3d4738}.board>div{background:#151a13;padding:30px}
.form label{display:block;color:#aeb8a8;font:11px ui-monospace,monospace;letter-spacing:.05em;margin:24px 0 0}.form label:first-of-type{margin-top:18px}.locked{float:right;color:#c8ff45;font-style:normal;font-size:10px}.form input{display:block;width:100%;padding:13px;background:#0e120d;border:1px solid #46523e;color:#f4f6ed;font:13px ui-monospace,monospace;outline:none}.form input:focus{border-color:#c8ff45;box-shadow:0 0 0 3px #c8ff4522}.form input:disabled{opacity:.6;cursor:not-allowed}
.asset-picker{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.asset-picker button{display:grid;gap:5px;padding:14px;text-align:left;border:1px solid #46523e;background:#0e120d;color:#899584;cursor:pointer}.asset-picker button b{font:900 15px ui-monospace,monospace;color:#dce9d1}.asset-picker button span{font:9px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em}.asset-picker button.on.xsgd{border-color:#c8ff45;background:#1d2818;box-shadow:inset 3px 0 #c8ff45}.asset-picker button.on.avax{border-color:#ff5e52;background:#291715;box-shadow:inset 3px 0 #ff5e52}.asset-picker button.on.avax b{color:#ff8e84}.asset-picker button:disabled{cursor:not-allowed}.asset-picker button:disabled:not(.on){opacity:.35}
.chips{display:flex;gap:6px;margin-top:8px}.chips button{padding:6px 11px;border:1px solid #46523e;background:#0e120d;color:#8b9784;font:11px ui-monospace,monospace;cursor:pointer}.chips button:hover{border-color:#c8ff45;color:#c8ff45}.chips button.on{background:#c8ff45;border-color:#c8ff45;color:#10140d;font-weight:700}
.field-help,.field-error{display:block;margin-top:8px;font:11px ui-monospace,monospace;line-height:1.6}.field-help{color:#8b9784}.field-error{color:#ff8f6b}.field-help b{color:#c8ff45}
.derived{display:grid;grid-template-columns:1fr auto;gap:7px 12px;margin:24px 0 10px;padding:16px;border:1px solid #3d4738;background:#0f140e;font:11px ui-monospace,monospace}.derived span{color:#8b9784}.derived b{color:#dce9d1}
.panel{display:flex;flex-direction:column;gap:14px}
.rail{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.rail-step{padding:11px 9px;border:1px solid #3d4738;background:#0f140e;font:10px ui-monospace,monospace;color:#6f7a68}.rail-step b{display:block;font-size:13px;margin-bottom:5px}.rail-step.now{border-color:#c8ff45;color:#dce9d1}.rail-step.now b{color:#c8ff45}.rail-step.done{border-color:#4c6b23;background:#1a2413;color:#9fb18d}.rail-step.done b{color:#c8ff45}
.live{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;padding:15px;border:1px solid #3d4738;background:#0f140e;font:11px ui-monospace,monospace}.live span{color:#8b9784}.live b{color:#dce9d1;text-align:right}
.cta-hint{color:#8b9784;font:11px ui-monospace,monospace;line-height:1.6;text-align:center}
.result{border:1px solid #c8ff45;background:#141c0e;box-shadow:0 10px 30px #00000040}.result header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #33421f;color:#c8ff45;font:700 10px ui-monospace,monospace;letter-spacing:.09em}.result header button{border:1px solid #c8ff45;background:#c8ff45;color:#10140d;padding:7px 13px;font:800 10px ui-monospace,monospace;cursor:pointer}.result header button:hover{background:#dcff7a}.result pre{margin:0;padding:16px 14px;color:#eaf7db;font:12px/1.75 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;user-select:all}.result footer{padding:11px 14px;border-top:1px solid #33421f;color:#8b9784;font:10px ui-monospace,monospace}.result footer b{color:#c8ff45}.link{border:0;background:none;padding:0;color:#c8ff45;font:inherit;text-decoration:underline;cursor:pointer}
.panel aside{padding:13px;border-left:3px solid #c8ff45;background:#20291a;color:#dce9d1;line-height:1.55;font-size:13px}.panel aside b{color:#c8ff45}
details{margin-top:auto;border-top:1px solid #3d4738;padding-top:14px}summary{cursor:pointer;color:#8b9784;font:11px ui-monospace,monospace;letter-spacing:.06em}.ids{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:14px 0;font:10px ui-monospace,monospace}.ids span{color:#8b9784}.ids code{color:#aeb8a8;overflow-wrap:anywhere}
.manual{display:grid;gap:7px;margin-bottom:10px}.manual :global(.ui-button){min-height:40px;font-size:11px}details small{color:#6f7a68;font:10px ui-monospace,monospace;line-height:1.6}
.handoff{display:grid;grid-template-columns:360px 1fr;gap:60px;margin-top:70px;padding-top:60px;border-top:1px solid #394233}.handoff h2{font-size:52px;line-height:.85;letter-spacing:-.06em;margin:16px 0 20px}.handoff .muted{color:#aeb8a8;line-height:1.65;font-size:14px;font-family:inherit;letter-spacing:normal}.handoff .muted code,.handoff .muted b{color:#c8ff45;font-size:13px}
.handoff-card{border:1px solid #3d4738;background:#11150f}.handoff-card header{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border-bottom:1px solid #354031;color:#8b9784;font:10px ui-monospace,monospace;letter-spacing:.09em}.handoff-card header button{border:1px solid #506044;background:#202a1b;color:#c8ff45;padding:6px 11px;font:700 10px ui-monospace,monospace;cursor:pointer}.handoff-card header button:hover{background:#c8ff45;color:#10140d}.handoff-card pre{margin:0;padding:18px 16px;overflow-x:auto;color:#dce9d1;font:12px/1.7 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}.handoff-card footer{padding:15px 16px;border-top:1px solid #354031;color:#8b9784;font-size:12px;line-height:1.6}
@media(max-width:980px){.board,.handoff{grid-template-columns:1fr}.handoff{gap:34px}}@media(max-width:520px){.sponsor{padding-inline:20px}.rail{grid-template-columns:repeat(2,1fr)}}`}</style>
  </main>;
}
