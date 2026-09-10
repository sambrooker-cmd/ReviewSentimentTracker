-- Review & Sentiment Tracker — Supabase schema
-- Run this once in the Supabase SQL editor for a new project.
-- See PLANNING.md §4 for the design rationale.

create extension if not exists pgcrypto;

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null unique check (type in ('trustpilot', 'google', 'feefo', 'tripadvisor', 'cruisecritic')),
  enabled boolean not null default true
);

insert into sources (name, type) values
  ('Trustpilot', 'trustpilot'),
  ('Google Business Profile', 'google'),
  ('Feefo', 'feefo'),
  ('TripAdvisor', 'tripadvisor'),
  ('Cruise Critic', 'cruisecritic')
on conflict (type) do nothing;

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id),
  filename text not null,
  imported_at timestamptz not null default now(),
  row_count int not null default 0
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id),
  external_id text,
  dedupe_hash text not null unique,
  rating smallint not null check (rating between 1 and 5),
  review_text text not null,
  author_display_name text,
  reviewer_raw_name text,
  review_date date not null,
  source_url text,
  import_batch_id uuid references import_batches(id),
  imported_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists reviews_review_date_idx on reviews (review_date);
create index if not exists reviews_source_id_idx on reviews (source_id);

create table if not exists themes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null check (category in ('complaint', 'praise'))
);

create table if not exists review_analysis (
  review_id uuid primary key references reviews(id) on delete cascade,
  sentiment_label text not null check (sentiment_label in ('positive', 'neutral', 'negative')),
  sentiment_score numeric not null check (sentiment_score between -1 and 1),
  quote_bank_candidate boolean not null default false,
  quote_bank_status text not null default 'pending' check (quote_bank_status in ('pending', 'approved', 'rejected')),
  quote_bank_rationale text,
  model text not null,
  analyzed_at timestamptz not null default now()
);

create table if not exists review_themes (
  review_id uuid not null references reviews(id) on delete cascade,
  theme_id uuid not null references themes(id) on delete cascade,
  primary key (review_id, theme_id)
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('sentiment_spike', 'theme_spike', 'import_stale')),
  source_id uuid references sources(id),
  window text,
  metric_value numeric,
  threshold numeric,
  summary text not null,
  triggered_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  github_issue_url text
);

create index if not exists alerts_open_idx on alerts (type, source_id, status);
