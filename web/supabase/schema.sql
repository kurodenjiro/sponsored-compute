-- Sponsored Compute: durable x402 payment persistence
-- Run this file once in Supabase Dashboard → SQL Editor.

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

comment on table public.sponsored_compute_claims is
  'Atomic nonce reservation for x402 replay protection across web instances.';

comment on table public.sponsored_compute_payments is
  'Settlement receipts shown in the Sponsored Compute merchant dashboard.';
