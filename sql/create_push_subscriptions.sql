-- Create table for push subscriptions (Supabase)
-- Run this in Supabase SQL editor or via psql connected to your Supabase DB.

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists pgcrypto;

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  nim text,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz default now()
);

-- Optional index for lookup by nim
create index if not exists idx_push_subscriptions_nim on push_subscriptions(nim);

-- Example queries:
-- select * from push_subscriptions limit 10;
-- delete from push_subscriptions where endpoint = '...';
