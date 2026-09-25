-- =============================================================================
-- 0003 · Tracking: visitors, events_log, purchases
-- =============================================================================

-- -----------------------------------------------------------------------------
-- visitors — quem chegou, de onde veio e como identificá-lo nos destinos
-- -----------------------------------------------------------------------------
create table if not exists public.visitors (
  id                uuid primary key default gen_random_uuid(),
  -- O identificador que viaja na URL do checkout e nos links de WhatsApp.
  trck_user_id      text not null unique,

  -- Dados pessoais em claro (para o painel) e já hasheados (para a CAPI).
  -- O hash é SHA-256 hex da forma normalizada — ver src/lib/hash.ts.
  email             text,
  phone             text,
  first_name        text,
  last_name         text,
  email_hash        text,
  phone_hash        text,
  first_name_hash   text,
  last_name_hash    text,
  city_hash         text,
  state_hash        text,
  country_hash      text,
  external_id_hash  text,

  -- Cookies do navegador. fbp/fbc NUNCA são hasheados.
  fbp               text,
  fbc               text,
  ga_client_id      text,
  ga_session_id     text,

  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_term          text,
  utm_content       text,
  referrer          text,
  landing_url       text,

  ip                inet,
  user_agent        text,
  geo_country       text,
  geo_region        text,
  geo_city          text,

  pixel_id          text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists visitors_created_at_idx   on public.visitors (created_at desc);
create index if not exists visitors_email_hash_idx   on public.visitors (email_hash) where email_hash is not null;
create index if not exists visitors_phone_hash_idx   on public.visitors (phone_hash) where phone_hash is not null;
create index if not exists visitors_utm_source_idx   on public.visitors (utm_source, created_at desc);
create index if not exists visitors_geo_country_idx  on public.visitors (geo_country);

-- -----------------------------------------------------------------------------
-- events_log — um registro por evento, com o payload e a resposta de cada destino
-- -----------------------------------------------------------------------------
create table if not exists public.events_log (
  id               uuid primary key default gen_random_uuid(),
  -- O MESMO id enviado ao Pixel no navegador: é ele que deduplica na Meta.
  event_id         text not null unique,
  trck_user_id     text,
  event_name       text not null,

  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_term         text,
  utm_content      text,

  event_source_url text,

  -- Campos pesados: zerados após 14 dias pela rotina de retenção (Fase 8).
  -- A LINHA permanece — data, evento, UTMs e geo seguem alimentando o painel.
  payload_meta     jsonb,
  response_meta    jsonb,
  payload_ga4      jsonb,
  response_ga4     jsonb,
  -- Marca que a retenção já passou aqui, para o lote não reprocessar.
  purged_at        timestamptz,

  ip               inet,
  geo_country      text,
  geo_region       text,
  geo_city         text,

  created_at       timestamptz not null default now()
);

create index if not exists events_log_created_at_idx  on public.events_log (created_at desc);
create index if not exists events_log_name_time_idx   on public.events_log (event_name, created_at desc);
create index if not exists events_log_trck_user_idx   on public.events_log (trck_user_id, created_at desc);
-- Índice da rotina de retenção: encontra rápido o que ainda não foi zerado.
create index if not exists events_log_purga_idx
  on public.events_log (created_at) where purged_at is null;

-- -----------------------------------------------------------------------------
-- purchases — a venda que chega pelo webhook, casada com o visitante
-- -----------------------------------------------------------------------------
create table if not exists public.purchases (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  text not null unique,
  trck_user_id    text,

  email           text,
  email_hash      text,
  phone           text,
  phone_hash      text,
  first_name      text,
  last_name       text,

  product_id      text,
  product_name    text,
  value           numeric(14,2),
  currency        text not null default 'BRL',
  status          text not null,
  platform        text,

  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,

  fbp             text,
  fbc             text,
  ga_client_id    text,
  ga_session_id   text,

  geo_country     text,
  geo_region      text,
  geo_city        text,

  -- Como a venda foi ligada ao visitante, e por quê. Auditável.
  match_method    text,
  match_reason    text,

  -- event_id derivado do transaction_id: reenvio não duplica na Meta.
  meta_event_id   text,
  response_meta   jsonb,
  response_ga4    jsonb,
  -- Preenchido no primeiro envio bem-sucedido: é o "já enviei?".
  sent_at         timestamptz,

  raw_webhook     jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint purchases_match_method_valido check (
    match_method is null
    or match_method in ('trck_user_id', 'email', 'phone', 'nenhum')
  ),
  constraint purchases_currency_iso check (currency ~ '^[A-Z]{3}$')
);

create index if not exists purchases_created_at_idx  on public.purchases (created_at desc);
create index if not exists purchases_trck_user_idx   on public.purchases (trck_user_id);
create index if not exists purchases_status_idx      on public.purchases (status, created_at desc);
create index if not exists purchases_email_hash_idx  on public.purchases (email_hash) where email_hash is not null;
create index if not exists purchases_utm_source_idx  on public.purchases (utm_source, created_at desc);
-- Fila de reenvio: o que ainda não foi para os destinos.
create index if not exists purchases_nao_enviadas_idx
  on public.purchases (created_at) where sent_at is null;

drop trigger if exists visitors_touch on public.visitors;
create trigger visitors_touch before update on public.visitors
  for each row execute function private.touch_updated_at();
drop trigger if exists purchases_touch on public.purchases;
create trigger purchases_touch before update on public.purchases
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — mesma regra: painel lê, só o service_role escreve.
-- -----------------------------------------------------------------------------
alter table public.visitors   enable row level security;
alter table public.events_log enable row level security;
alter table public.purchases  enable row level security;

drop policy if exists "visitors: leitura autenticada" on public.visitors;
create policy "visitors: leitura autenticada"
  on public.visitors for select to authenticated using (true);
drop policy if exists "events_log: leitura autenticada" on public.events_log;
create policy "events_log: leitura autenticada"
  on public.events_log for select to authenticated using (true);
drop policy if exists "purchases: leitura autenticada" on public.purchases;
create policy "purchases: leitura autenticada"
  on public.purchases for select to authenticated using (true);

-- Segunda tranca: a RLS já barra a escrita (não há policy de INSERT/UPDATE/
-- DELETE), mas tirar o privilégio fecha a porta também no caso de alguém
-- adicionar uma policy por engano mais adiante.
revoke insert, update, delete, truncate
  on public.visitors, public.events_log, public.purchases
  from anon, authenticated;

-- E o `anon` não tem o que fazer aqui: as policies são todas `to
-- authenticated`, então a RLS já devolve zero linhas para ele. Tirar o
-- privilégio também é a terceira tranca — dados pessoais (e-mail, IP, geo)
-- não deveriam depender de uma única camada.
revoke all on public.visitors, public.events_log, public.purchases from anon;
