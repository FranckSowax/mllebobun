-- ============================================================
-- MADEMOISELLE BOBÙN — schéma des commandes (Supabase / Postgres)
-- À exécuter une fois dans l'éditeur SQL de Supabase.
-- ============================================================

create table if not exists public.orders (
  session_id  text primary key,           -- id de session Stripe / id sur place
  code        text,                        -- code de retrait (BB-XXXX)
  order_date  timestamptz,                 -- date/heure de la commande
  items       jsonb not null default '[]', -- [{name, qty, amount}]
  amount      integer not null default 0,  -- total en centimes
  note        text default '',
  phone       text default '',
  email       text default '',
  status      text default 'payée',        -- 'payée' | 'sur place'
  drive       jsonb,                       -- {vehicle, at} si le client est en drive
  created_at  timestamptz not null default now()
);

create index if not exists orders_order_date_idx on public.orders (order_date desc);
create index if not exists orders_status_idx on public.orders (status);

-- Sécurité : la table n'est accessible qu'avec la clé service_role (côté serveur).
-- On active RLS sans policy publique -> aucun accès via la clé anon/publique.
alter table public.orders enable row level security;

-- (facultatif) vue pratique pour le suivi : chiffre d'affaires par jour
create or replace view public.orders_daily as
select
  (order_date at time zone 'Europe/Paris')::date as jour,
  count(*)                                        as commandes,
  sum(amount) / 100.0                             as ca_eur,
  sum((select coalesce(sum((i->>'qty')::int), 0)
       from jsonb_array_elements(items) i
       where i->>'name' not ilike 'suppl%'))      as bols
from public.orders
group by 1
order by 1 desc;
