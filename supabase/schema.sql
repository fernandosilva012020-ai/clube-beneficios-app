-- Prosperidade Digital — base inicial segura e configurável.
-- Os valores de plano e percentuais NÃO são fixados aqui.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  whatsapp text,
  referral_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  sponsor_id uuid references public.profiles(id) on delete set null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents integer,
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','quarterly','yearly','one_time')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','active','past_due','canceled','expired')),
  starts_at timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('course','tool','ai')),
  title text not null,
  description text,
  cover_url text,
  destination_url text,
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  progress integer not null default 0 check (progress between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_id)
);

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  level integer not null check (level > 0),
  event_type text not null check (event_type in ('membership_payment','product_purchase')),
  percentage numeric(7,4) check (percentage is null or (percentage >= 0 and percentage <= 100)),
  fixed_amount_cents integer check (fixed_amount_cents is null or fixed_amount_cents >= 0),
  active boolean not null default true,
  constraint one_value_required check (percentage is not null or fixed_amount_cents is not null),
  unique(level,event_type)
);

create table if not exists public.commission_events (
  id uuid primary key default gen_random_uuid(),
  source_user_id uuid not null references public.profiles(id) on delete restrict,
  beneficiary_user_id uuid not null references public.profiles(id) on delete restrict,
  level integer not null check (level > 0),
  event_type text not null,
  source_reference text not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','reversed','canceled')),
  created_at timestamptz not null default now(),
  unique(event_type, source_reference, beneficiary_user_id, level)
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.memberships enable row level security;
alter table public.content_items enable row level security;
alter table public.course_progress enable row level security;
alter table public.commission_rules enable row level security;
alter table public.commission_events enable row level security;
alter table public.app_settings enable row level security;

create policy "profiles_self_select" on public.profiles for select to authenticated
using (id = (select auth.uid()) or sponsor_id = (select auth.uid()));
create policy "profiles_self_update" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "plans_authenticated_read" on public.plans for select to authenticated using (active = true);
create policy "memberships_self_read" on public.memberships for select to authenticated using (user_id = (select auth.uid()));
create policy "content_authenticated_read" on public.content_items for select to authenticated using (published = true);
create policy "progress_self_all" on public.course_progress for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "commission_events_self_read" on public.commission_events for select to authenticated
using (beneficiary_user_id = (select auth.uid()));

-- Regras e configurações administrativas não recebem policy de cliente.
-- Operações de admin devem passar por Edge Function autenticada ou RPC com autorização explícita.

create index if not exists profiles_sponsor_idx on public.profiles(sponsor_id);
create index if not exists memberships_user_idx on public.memberships(user_id,status);
create index if not exists content_kind_idx on public.content_items(kind,published,sort_order);
create index if not exists commissions_beneficiary_idx on public.commission_events(beneficiary_user_id,status,created_at desc);
