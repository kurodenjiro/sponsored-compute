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

alter table public.sponsored_compute_claims enable row level security;
alter table public.sponsored_compute_payments enable row level security;

comment on table public.sponsored_compute_claims is
  'Short-lived idempotency claims for x402 payments. Accessed by the server secret key.';
comment on table public.sponsored_compute_payments is
  'Server-side settlement ledger for sponsored compute payments.';
