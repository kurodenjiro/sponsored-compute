create table if not exists public.sponsored_compute_claims (
  nonce text not null,
  resource text not null,
  expires_at timestamptz not null,
  primary key (nonce, resource)
);

create table if not exists public.sponsored_compute_payments (
  id bigint generated always as identity primary key,
  nonce text,
  resource text,
  created_at timestamptz not null default now(),
  ok boolean not null,
  payer text,
  amount text not null,
  tx text,
  error text
);

create index if not exists sponsored_compute_payments_created_at
  on public.sponsored_compute_payments (created_at desc);

-- Sổ tra cứu repo được tài trợ. KHÔNG cấp quyền: campaign thật nằm trên chain,
-- bảng này chỉ ánh xạ repo → campaignId để người và agent tìm được nhau.
create table if not exists public.sponsored_compute_repos (
  campaign_id text primary key,
  chain_id integer not null,
  repo_url text not null,
  repo_slug text not null,
  sponsor text not null,
  sponsor_address text not null,
  grant_amount text not null,
  funded text not null,
  committed text not null,
  tx text,
  created_at timestamptz not null default now()
);

create index if not exists sponsored_compute_repos_created_at
  on public.sponsored_compute_repos (created_at desc);

-- Dev báo lại đã claim. Ghi SAU khi grantOf(projectId) đọc được trên chain.
create table if not exists public.sponsored_compute_grant_claims (
  project_id text primary key,
  campaign_id text not null,
  chain_id integer not null,
  grant_id text not null,
  owner text not null,
  signer text not null,
  tx text,
  created_at timestamptz not null default now()
);

create index if not exists sponsored_compute_grant_claims_campaign
  on public.sponsored_compute_grant_claims (campaign_id, created_at desc);

alter table public.sponsored_compute_repos enable row level security;
alter table public.sponsored_compute_grant_claims enable row level security;

comment on table public.sponsored_compute_repos is
  'Repository → campaign lookup. Written by the sponsor console after the campaign is funded on-chain.';
comment on table public.sponsored_compute_grant_claims is
  'Developer Grant claims, verified against GrantManager before insertion.';

alter table public.sponsored_compute_claims enable row level security;
alter table public.sponsored_compute_payments enable row level security;

comment on table public.sponsored_compute_claims is
  'Short-lived idempotency claims for x402 payments. Accessed by the server secret key.';
comment on table public.sponsored_compute_payments is
  'Server-side settlement ledger for sponsored compute payments.';
