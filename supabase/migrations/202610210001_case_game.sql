-- The Case Room: private server-side gameplay state and opt-in analytics.
create extension if not exists pgcrypto;

create table if not exists public.case_game_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  case_id text not null check (case_id in ('001','002')),
  mechanic text not null check (mechanic in ('matrix','dossier')),
  status text not null default 'open' check (status in ('open','solved','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists case_game_sessions_expiry_idx on public.case_game_sessions (expires_at);

create table if not exists public.case_game_analytics (
  id bigint generated always as identity primary key,
  event_name text not null check (event_name in ('case_started','accusation_submitted','case_completed')),
  case_id text not null check (case_id in ('001','002')),
  analytics_session_id uuid,
  user_agent_class text check (user_agent_class in ('mobile','desktop')),
  outcome text check (outcome in ('solved','failed','wrong')),
  created_at timestamptz not null default now()
);

alter table public.case_game_sessions enable row level security;
alter table public.case_game_analytics enable row level security;
revoke all on public.case_game_sessions from anon, authenticated;
revoke all on public.case_game_analytics from anon, authenticated;
grant all on public.case_game_sessions to service_role;
grant all on public.case_game_analytics to service_role;
