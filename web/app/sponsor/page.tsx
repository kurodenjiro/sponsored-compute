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

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { avalancheFuji } from 'viem/chains';
import { createPublicClient, createWalletClient, custom, http, parseUnits } from 'viem';
import { campaignIdOf, capsFor, formatAmount, merchantIdOf, parseRepoUrl, sponsorSlugOf, type RepoRef } from '../../../src/campaign.js';

const RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const CHAIN_ID = 43113;
const GRANT_MANAGER = '0x3230B5666d8De86d3079D07bb45A7075A1d0b043' as const;
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
  { name: 'attestor', type: 'address' }, { name: 'paused', type: 'bool' },
] as const;
const grantAbi = [
  { type: 'function', name: 'registry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'xsgd', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'campaigns', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: campaignTuple },
  { type: 'function', name: 'createCampaign', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'c', type: 'tuple', components: campaignTuple }], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const;
const erc20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;

const amount = formatAmount;
const sgd = (v: bigint) => `${formatAmount(v)} XSGD`;
const GRANT_PRESETS = ['0.10', '1.00', '2.00', '10.00'];
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
};
const emptyChain: Chain = { loading: true, merchantPayTo: '', exists: false, paused: false, available: 0n, grantAmount: 0n };

export default function SponsorPage() {
  const [repoUrl, setRepoUrl] = useState('https://github.com/supadb/supadb-starter');
  const [debouncedUrl, setDebouncedUrl] = useState(repoUrl);
  const [grant, setGrant] = useState('2.00');
  const [seats, setSeats] = useState('3');
  const [wallet, setWallet] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [chain, setChain] = useState<Chain>(emptyChain);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ install: string; manifest: string; mcp: string; seats: number; repo: string } | null>(null);
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

  const typedGrant = useMemo(() => {
    try { return parseUnits(grant || '0', 6); } catch { return 0n; }
  }, [grant]);
  // Campaign đã tồn tại → cỡ Grant do chain quyết, ô nhập chỉ còn là ghi chú.
  const grantAtomic = chain.exists ? chain.grantAmount : typedGrant;
  const seatCount = Math.max(1, Math.min(1000, Number(seats) || 1));
  const poolAtomic = grantAtomic * BigInt(seatCount);
  const caps = capsFor(grantAtomic);
  const seatsLeft = grantAtomic > 0n ? Number(chain.available / grantAtomic) : 0;
  const merchantApproved = chain.merchantPayTo !== '' && chain.merchantPayTo !== zero;
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
        available: campaign[2] - campaign[3], grantAmount: campaign[4],
      });
    } catch {
      setChain((c) => ({ ...c, loading: false }));
      setStatus('Không đọc được state trên Fuji. Kiểm tra kết nối RPC Avalanche.');
    }
  }, [repo, merchantId, campaignId]);

  useEffect(() => { setResult(null); void readChain(); }, [readChain]);

  const readBalance = useCallback(async (account: string) => {
    try {
      const xsgd = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'xsgd' });
      setBalance(await publicClient.readContract({ address: xsgd, abi: erc20Abi, functionName: 'balanceOf', args: [account as `0x${string}`] }));
    } catch { setBalance(null); }
  }, []);

  const connectWallet = async () => {
    const ethereum = (window as typeof window & { ethereum?: any }).ethereum;
    if (!ethereum) return setStatus('Không thấy ví Core hoặc EVM nào. Cài extension Core rồi thử lại.');
    setBusy(true);
    try {
      const client = createWalletClient({ chain: avalancheFuji, transport: custom(ethereum) });
      const [account] = await client.requestAddresses();
      if (!account) throw new Error('Chưa chọn tài khoản ví.');
      await client.switchChain({ id: avalancheFuji.id });
      setWallet(account);
      void readBalance(account);
      setStatus(`Ví ${short(account)} đã kết nối — nó là payTo của merchant và là sponsor của campaign.`);
    } catch (error: any) {
      setStatus(`Kết nối ví thất bại: ${error?.shortMessage ?? error?.message ?? 'người dùng từ chối'}`);
    } finally { setBusy(false); }
  };

  const run = async (label: string, action: (account: `0x${string}`, client: ReturnType<typeof createWalletClient>) => Promise<`0x${string}` | void>) => {
    const ethereum = (window as typeof window & { ethereum?: unknown }).ethereum;
    if (!ethereum) return setStatus('Không thấy ví injected. Mở khoá Core, MetaMask hoặc ví EVM khác.');
    setBusy(true);
    try {
      const client = createWalletClient({ chain: avalancheFuji, transport: custom(ethereum as any) });
      const [account] = await client.requestAddresses();
      if (!account) throw new Error('Chưa chọn tài khoản ví.');
      setWallet(account);
      setStatus(`${label}: đang chờ chữ ký…`);
      const hash = await action(account, client);
      if (hash) {
        setStatus(`${label}: đã gửi ${hash.slice(0, 10)}… — chờ xác nhận.`);
        await publicClient.waitForTransactionReceipt({ hash });
        setStatus(`${label}: xác nhận trên Avalanche Fuji.`);
      }
      await Promise.all([readChain(), readBalance(account)]);
      return true;
    } catch (error: any) {
      setStatus(`${label}: ${error?.shortMessage ?? error?.message ?? 'giao dịch thất bại'}`);
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
    setStatus('Đang duyệt merchant tự động…');
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
      setStatus(`Duyệt merchant: ${error?.message ?? 'thất bại'}`);
      return false;
    }
  };

  const createCampaign = () => run('Tạo campaign', async (account, client) => client.writeContract({
    account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'createCampaign',
    args: [campaignId, {
      sponsor: account, merchantId, funded: 0n, committed: 0n,
      grantAmount: grantAtomic, trancheCount: 2, tranchePeriod: 86_400,
      minSpendPerTranche: 0n, minDaysPerTranche: 0, grantValidity: BigInt(30 * 86_400),
      perTxCap: caps.perTxCap, dailyCap: caps.dailyCap, attestor: zero, paused: false,
    }],
  }));

  const fundCampaign = () => run(`Nạp ${sgd(poolAtomic)}`, async (account, client) => {
    const xsgd = await publicClient.readContract({ address: GRANT_MANAGER, abi: grantAbi, functionName: 'xsgd' });
    setStatus('Bước 1/2 — duyệt XSGD cho GrantManager…');
    const approval = await client.writeContract({ account, chain: avalancheFuji, address: xsgd, abi: erc20Abi, functionName: 'approve', args: [GRANT_MANAGER, poolAtomic] });
    await publicClient.waitForTransactionReceipt({ hash: approval });
    setStatus('Bước 2/2 — nạp vào campaign…');
    return client.writeContract({ account, chain: avalancheFuji, address: GRANT_MANAGER, abi: grantAbi, functionName: 'fund', args: [campaignId, poolAtomic] });
  });

  /** Không ký gì: registry đọc lại chain rồi mới trả chuỗi cài. */
  const registerRepo = useCallback(async () => {
    if (!repo) return;
    setBusy(true);
    setStatus('Đang đăng ký repo với Sponsored Compute…');
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
        seats: data.seats,
        repo: repo.slug,
      });
      setStatus(`${repo.slug} đã sẵn sàng. Dán lệnh bên dưới vào repo — dev chỉ cần từng đó.`);
    } catch (error: any) {
      setStatus(`Đăng ký repo: ${error?.message ?? 'thất bại'}`);
    } finally { setBusy(false); }
  }, [repo, sponsor, campaignId]);

  /** Merchant phải nằm trong allowlist trước khi Grant tiêu được, nên duyệt luôn ở đây. */
  const approveThenCreate = async () => {
    setBusy(true);
    const ok = await ensureMerchant(wallet);
    setBusy(false);
    if (ok) await createCampaign();
  };

  /** Nạp xong là đủ điều kiện — không bắt bấm thêm một nút nữa. */
  const fundThenRegister = async () => { if (await fundCampaign()) await registerRepo(); };

  const primary: Record<typeof stage, { label: string; action: () => void; hint: string }> = {
    repo: { label: 'Nhập repo hợp lệ và số tiền', action: () => {}, hint: parsed.error || 'Số XSGD mỗi developer phải lớn hơn 0.' },
    wallet: { label: 'Kết nối ví để tiếp tục', action: connectWallet, hint: 'Ví này trả tiền, nhận payTo, và sở hữu campaign.' },
    create: { label: `Tạo campaign cho ${repo?.slug ?? ''}`, action: approveThenCreate, hint: `Cỡ Grant ${sgd(grantAtomic)} khoá vĩnh viễn lúc tạo — sau này chỉ nạp thêm được.${merchantApproved ? '' : ' Merchant được duyệt tự động, bạn không phải ký thêm.'}` },
    fund: { label: `Duyệt & nạp ${sgd(poolAtomic)}`, action: fundThenRegister, hint: `${seatCount} suất × ${sgd(grantAtomic)}. Hai chữ ký: approve rồi fund. Xong sẽ tự lấy chuỗi cài.` },
    ready: { label: 'Lấy chuỗi cài vào repo', action: registerRepo, hint: 'Không ký gì — chỉ đọc lại campaign trên chain rồi sinh lệnh.' },
  };
  const steps = [
    { key: 'wallet', n: '01', label: 'Ví', done: Boolean(wallet) },
    { key: 'create', n: '02', label: 'Campaign', done: chain.exists },
    { key: 'fund', n: '03', label: 'Nạp XSGD', done: chain.exists && seatsLeft >= 1 },
    { key: 'ready', n: '04', label: 'Chuỗi cài', done: Boolean(result) },
  ];

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1_800);
    } catch { /* Không có quyền clipboard: text vẫn bôi đen copy tay được. */ }
  };

  return <main className="sponsor">
    <nav><Link href="/" className="brand">sponsored<span>compute</span></Link><Link href="/merchant">Merchant dashboard ↗</Link></nav>
    <header>
      <p>SPONSOR CONSOLE · MỘT NÚT MỖI LÚC</p>
      <h1>Fund a repo.<br /><em>Not a wallet.</em></h1>
      <span>DÁN REPO → NẠP XSGD → NHẬN MỘT DÒNG LỆNH ĐỂ ĐƯA VÀO REPO</span>
    </header>

    <section className="board">
      <div className="form">
        <p>CAMPAIGN</p>
        <label htmlFor="repo">Repo GitHub</label>
        <Input id="repo" value={repoUrl} placeholder="https://github.com/owner/repo" onChange={(e) => setRepoUrl(e.target.value)} />
        <small className={parsed.error ? 'field-error' : 'field-help'}>
          {parsed.error || <>sponsor <b>{sponsor}</b> · campaign suy ra từ <b>{repo?.host}/{repo?.slug}</b></>}
        </small>

        <label htmlFor="grant">XSGD mỗi developer{chain.exists && <em className="locked">đã khoá on-chain</em>}</label>
        <Input id="grant" value={chain.exists ? amount(chain.grantAmount) : grant} disabled={chain.exists} onChange={(e) => setGrant(e.target.value)} />
        {!chain.exists && <div className="chips">{GRANT_PRESETS.map((v) => <button key={v} className={grant === v ? 'on' : ''} onClick={() => setGrant(v)}>{v}</button>)}</div>}
        <small className="field-help">
          {chain.exists
            ? 'Campaign đã tồn tại nên cỡ Grant không sửa được nữa — tạo repo khác nếu muốn mức khác.'
            : 'Mỗi dev claim được đúng ngần này, nhả dần theo 2 tranche.'}
        </small>

        <label htmlFor="seats">Số suất nạp thêm</label>
        <Input id="seats" value={seats} onChange={(e) => setSeats(e.target.value)} />
        <div className="chips">{SEAT_PRESETS.map((v) => <button key={v} className={seats === v ? 'on' : ''} onClick={() => setSeats(v)}>{v}</button>)}</div>
        <small className="field-help">Sắp nạp: <b>{sgd(poolAtomic)}</b> = {sgd(grantAtomic)} × {seatCount}</small>

        <div className="derived">
          <span>trần mỗi giao dịch</span><b>{sgd(caps.perTxCap)}</b>
          <span>trần mỗi ngày</span><b>{sgd(caps.dailyCap)}</b>
          <span>hiệu lực Grant</span><b>30 ngày</b>
          <span>merchant payTo</span><b>{merchantApproved ? short(chain.merchantPayTo) : wallet ? short(wallet) : 'ví sẽ kết nối'}</b>
        </div>
        <small className="field-help">Ví của developer và của agent không nhập ở đây. Dev tự gắn ví của họ lúc claim.</small>
      </div>

      <div className="panel">
        <div className="rail">{steps.map((s) => <div key={s.key} className={`rail-step ${s.done ? 'done' : stage === s.key ? 'now' : ''}`}><b>{s.done ? '✓' : s.n}</b><span>{s.label}</span></div>)}</div>

        <div className="live">
          <span>trạng thái repo</span>
          <b>{chain.loading ? 'đang đọc Fuji…' : !repo ? '—' : chain.paused ? 'campaign đang pause' : chain.exists ? `${seatsLeft} suất còn trống · ${sgd(chain.available)}` : 'chưa có campaign'}</b>
          <span>ví</span>
          <b>{wallet ? `${short(wallet)}${balance === null ? '' : ` · ${sgd(balance)}`}` : 'chưa kết nối'}</b>
          <span>merchant</span>
          <b>{chain.loading ? '…' : merchantApproved ? `đã duyệt · ${short(chain.merchantPayTo)}` : 'duyệt tự động khi tạo campaign'}</b>
        </div>

        {/* Kết quả phải nằm NGAY chỗ vừa bấm — không bắt người dùng cuộn đi tìm. */}
        {result ? <div className="result">
          <header><span>CHẠY LỆNH NÀY TRONG REPO</span><button onClick={() => copy('install', result.install)}>{copied === 'install' ? 'Đã copy ✓' : 'Copy'}</button></header>
          <pre>{result.install}</pre>
          <footer>
            <b>{result.seats}</b> suất đang được tài trợ · <button className="link" onClick={() => document.getElementById('handoff')?.scrollIntoView({ behavior: 'smooth' })}>xem sponsored.json và bước tiếp theo ↓</button>
          </footer>
        </div> : <>
          <Button className="cta" disabled={busy || stage === 'repo' || chain.loading || (stage === 'fund' && shortOfFunds)} onClick={primary[stage].action}>
            {busy ? 'đang xử lý…' : primary[stage].label}
          </Button>
          <small className="cta-hint">{stage === 'fund' && shortOfFunds ? `Ví chỉ có ${sgd(balance!)} — thiếu ${sgd(poolAtomic - balance!)}. Giảm số suất hoặc nạp thêm XSGD.` : primary[stage].hint}</small>
        </>}

        {status && <aside>{status}</aside>}

        <details>
          <summary>Chi tiết on-chain</summary>
          <div className="ids">
            <span>merchantId</span><code>{merchantId}</code>
            <span>campaignId</span><code>{campaignId}</code>
            <span>GrantManager</span><code>{GRANT_MANAGER}</code>
            <span>chain</span><code>avalanche-fuji / {CHAIN_ID}</code>
          </div>
          <div className="manual">
            <Button disabled={busy || !repo || merchantApproved || !wallet} onClick={() => ensureMerchant(wallet)}>Chỉ duyệt merchant (server ký)</Button>
            <Button disabled={busy || !repo || chain.exists} onClick={createCampaign}>Chỉ tạo campaign</Button>
            <Button disabled={busy || !chain.exists} onClick={fundCampaign}>Chỉ nạp {sgd(poolAtomic)}</Button>
            <Button disabled={busy || !chain.exists} onClick={registerRepo}>Chỉ lấy chuỗi cài</Button>
          </div>
          <small>Mỗi nút là một chữ ký ví riêng. Website không bao giờ nhận private key.</small>
        </details>
      </div>
    </section>

    {result && <section className="handoff" id="handoff">
      <div>
        <p>ĐƯA VÀO REPO</p>
        <h2>Một dòng.<br />Không bí mật.</h2>
        <p className="muted">Chạy trong thư mục gốc của <code>{result.repo}</code>, rồi commit <code>sponsored.json</code> và <code>.mcp.json</code>. Nó chỉ ghi con trỏ: không key, không địa chỉ ví, không địa chỉ contract. Hiện có <b>{result.seats}</b> suất đã được tài trợ.</p>
      </div>
      <div className="handoff-card">
        <header><span>1 · CHẠY TRONG REPO</span><button onClick={() => copy('install', result.install)}>{copied === 'install' ? 'Đã copy ✓' : 'Copy'}</button></header>
        <pre>{result.install}</pre>
        <header><span>2 · NÓ GHI RA sponsored.json</span><button onClick={() => copy('manifest', result.manifest)}>{copied === 'manifest' ? 'Đã copy ✓' : 'Copy'}</button></header>
        <pre>{result.manifest}</pre>
        <header><span>3 · VÀ .mcp.json — CLONE XONG LÀ CHẠY</span><button onClick={() => copy('mcp', result.mcp)}>{copied === 'mcp' ? 'Đã copy ✓' : 'Copy'}</button></header>
        <pre>{result.mcp}</pre>
        <footer>Phía dev: clone repo, mở Claude Code, hỏi “dự án này có tài trợ không?”. MCP verify campaign on-chain rồi phát Grant riêng cho ví của dev đó.</footer>
      </div>
    </section>}

    <style jsx>{`:global(body){margin:0;background:#0d0f0b;color:#f4f6ed;font-family:'Helvetica Neue',Helvetica,sans-serif}.sponsor{min-height:100vh;padding:0 4.5vw 90px;background:radial-gradient(ellipse 72% 42% at 50% 0%,#21331c 0%,#0d0f0b 68%)}nav{height:76px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #354031;font:11px ui-monospace,monospace;letter-spacing:.08em}nav a{color:#c8ff45;text-decoration:none}.brand{font:800 17px 'Helvetica Neue';letter-spacing:-.07em;color:#f4f6ed!important}.brand span,header p,.form>p,.handoff p:first-child{color:#c8ff45}header{padding:82px 0 54px}header p,.form>p,.handoff p:first-child{font:700 11px ui-monospace,monospace;letter-spacing:.12em}header h1{font-size:clamp(50px,7.5vw,96px);line-height:.82;letter-spacing:-.08em;margin:16px 0 26px}header em,.handoff em{font-style:normal;color:#c8ff45}header>span{color:#c8ff45;font:10px ui-monospace,monospace}
.board{display:grid;grid-template-columns:1fr .9fr;gap:1px;background:#3d4738;border:1px solid #3d4738}.board>div{background:#151a13;padding:30px}
.form label{display:block;color:#aeb8a8;font:11px ui-monospace,monospace;letter-spacing:.05em;margin:24px 0 0}.form label:first-of-type{margin-top:18px}.locked{float:right;color:#c8ff45;font-style:normal;font-size:10px}.form input{display:block;width:100%;padding:13px;background:#0e120d;border:1px solid #46523e;color:#f4f6ed;font:13px ui-monospace,monospace;outline:none}.form input:focus{border-color:#c8ff45;box-shadow:0 0 0 3px #c8ff4522}.form input:disabled{opacity:.6;cursor:not-allowed}
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
