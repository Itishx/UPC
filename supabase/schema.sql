-- Unplug Collective — database schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).

-- ---------------------------------------------------------------------------
-- Sessions (one row per event / volume)
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id              bigint generated always as identity primary key,
  volume_number   integer not null unique,
  title           text    not null,
  event_date      date    not null,
  venue           text,
  city            text,
  performer_price integer not null default 299,
  listener_price  integer not null default 199,
  capacity        integer,
  is_open         boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now()
);

comment on table public.sessions is 'One row per Unplug Collective event (Volume 1, 2, 3 ...)';

-- ---------------------------------------------------------------------------
-- Registrations (one row per booking)
-- ---------------------------------------------------------------------------
create table if not exists public.registrations (
  id               bigint generated always as identity primary key,
  session_id       bigint not null references public.sessions(id) on delete restrict,
  volume_number    integer not null,

  full_name        text    not null,
  age              integer not null check (age between 10 and 100),
  phone            text    not null check (phone ~ '^[0-9]{10}$'),
  instagram        text    not null,

  tier             text    not null check (tier in ('performer', 'listener')),
  amount           integer not null check (amount >= 0),

  payment_status   text    not null default 'pending'
                     check (payment_status in ('pending', 'paid', 'refunded', 'cancelled')),
  payment_ref      text,
  attended         boolean,

  created_at       timestamptz not null default now()
);

-- One booking per phone number per event.
create unique index if not exists registrations_session_phone_key
  on public.registrations (session_id, phone);

create index if not exists registrations_session_idx  on public.registrations (session_id);
create index if not exists registrations_volume_idx   on public.registrations (volume_number);
create index if not exists registrations_created_idx  on public.registrations (created_at desc);
create index if not exists registrations_tier_idx     on public.registrations (tier);

comment on table public.registrations is 'One row per person booked onto a session';

-- ---------------------------------------------------------------------------
-- Keep volume_number in sync with the session it points at
-- ---------------------------------------------------------------------------
create or replace function public.set_registration_volume()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select s.volume_number into new.volume_number
  from public.sessions s
  where s.id = new.session_id;

  -- Price is decided by the server, never trusted from the browser.
  select case when new.tier = 'performer' then s.performer_price else s.listener_price end
    into new.amount
  from public.sessions s
  where s.id = new.session_id;

  return new;
end;
$$;

drop trigger if exists registrations_set_volume on public.registrations;
create trigger registrations_set_volume
  before insert or update of session_id, tier on public.registrations
  for each row execute function public.set_registration_volume();

-- ---------------------------------------------------------------------------
-- Row Level Security
--   * anyone (anon key) may READ sessions and INSERT a registration
--   * nobody may read/update/delete registrations with the anon key
--     -> the admin page reads them with the service role key
-- ---------------------------------------------------------------------------
alter table public.sessions      enable row level security;
alter table public.registrations enable row level security;

drop policy if exists "sessions are publicly readable" on public.sessions;
create policy "sessions are publicly readable"
  on public.sessions for select
  to anon, authenticated
  using (true);

drop policy if exists "anyone can register" on public.registrations;
create policy "anyone can register"
  on public.registrations for insert
  to anon, authenticated
  with check (
    session_id in (select id from public.sessions where is_open = true)
  );

-- No select/update/delete policy for anon => registrations are write-only
-- from the browser. Admin reads go through the service role key.

-- ---------------------------------------------------------------------------
-- Analytics view used by the admin dashboard
-- ---------------------------------------------------------------------------
create or replace view public.session_stats as
select
  s.id                as session_id,
  s.volume_number,
  s.title,
  s.event_date,
  s.venue,
  s.city,
  s.capacity,
  count(r.id)                                                    as total_registrations,
  count(r.id) filter (where r.tier = 'performer')                as performers,
  count(r.id) filter (where r.tier = 'listener')                 as listeners,
  coalesce(sum(r.amount), 0)                                     as revenue_expected,
  coalesce(sum(r.amount) filter (where r.payment_status = 'paid'), 0) as revenue_collected,
  count(r.id) filter (where r.payment_status = 'paid')           as paid_count,
  count(r.id) filter (where r.payment_status = 'pending')        as pending_count,
  count(r.id) filter (where r.attended)                          as attended_count,
  round(avg(r.age), 1)                                           as avg_age
from public.sessions s
left join public.registrations r on r.session_id = s.id
group by s.id
order by s.volume_number desc;

-- ---------------------------------------------------------------------------
-- Seed: Volume 6 (and past volumes so the admin dashboard has comparisons)
-- ---------------------------------------------------------------------------
insert into public.sessions (volume_number, title, event_date, venue, city, capacity, is_open)
values
  (1, 'Unplug Collective — Volume 1', '2025-09-23', 'Bloom Cafe',        'Bengaluru', 40, false),
  (2, 'Unplug Collective — Volume 2', '2025-11-23', 'Bloom Cafe',        'Bengaluru', 45, false),
  (3, 'Unplug Collective — Volume 3', '2026-01-23', 'The Courtyard',     'Bengaluru', 50, false),
  (4, 'Unplug Collective — Volume 4', '2026-03-23', 'The Courtyard',     'Bengaluru', 55, false),
  (5, 'Unplug Collective — Volume 5', '2026-05-23', 'Maple House',       'Bengaluru', 60, false),
  (6, 'Unplug Collective — Volume 6', '2026-08-22', 'To be announced',   'Bengaluru', 60, true)
on conflict (volume_number) do nothing;
