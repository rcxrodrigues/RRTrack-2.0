-- ############################################################################
-- RRTrack 2.0 · INSTALAÇÃO COMPLETA DO BANCO
--
-- GERADO AUTOMATICAMENTE por supabase/tests/gerar-instalador.sh
-- Não edite à mão: mexa nas migrations e rode o gerador de novo.
--
-- Cole ESTE ARQUIVO INTEIRO no SQL Editor do Supabase e rode uma única vez.
-- Ele é idempotente: rodar de novo não quebra nada.
--
-- No fim, ele imprime um relatório dizendo se tudo ficou no lugar.
-- ############################################################################

-- ============================================================================
-- PARTE 0 · Conferir o cofre
-- ----------------------------------------------------------------------------
-- Os tokens ficam no Supabase Vault, cuja chave-mestra vive FORA do banco.
-- Se a extensão não estiver ativa, melhor parar aqui com uma instrução clara.
-- ============================================================================
do $inst0$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise exception using
      errcode = 'undefined_schema',
      message = 'O Supabase Vault não está ativo neste projeto',
      hint    = 'Vá em Database > Extensions, ative "supabase_vault" e rode este arquivo de novo.';
  end if;
  raise notice 'Cofre (Supabase Vault) disponivel.';
end;
$inst0$;


-- ============================================================================
-- MIGRATION · 20260921120000_extensoes_e_segredos
-- ============================================================================
-- =============================================================================
-- 0001 · Extensões, schema privado e o cofre dos segredos
-- =============================================================================
-- Os tokens da Meta e o api_secret do GA4 ficam no SUPABASE VAULT.
--
-- Por que o Vault e não `pgp_sym_encrypt` com uma chave nossa:
--
--   O plano original guardava a chave no catálogo do Postgres, via
--   `ALTER DATABASE ... SET app.settings.encryption_key`. O Supabase não
--   permite: esse comando exige privilégio de dono do banco, e o role
--   `postgres` de um projeto não o tem (erro 42501). Não é contornável.
--
--   O Vault resolve melhor do que a ideia original: a chave-mestra vive FORA
--   do Postgres, gerenciada pela plataforma. Nem um `pg_dump`, nem um
--   `pg_dumpall`, nem um backup vazado decifram coisa alguma — o que era
--   justamente o limite que assumimos ao escolher a chave no catálogo.
--
--   Por baixo, o Vault também é cifra simétrica autenticada. Muda o lugar
--   onde a chave mora, não o princípio.
--
-- As tabelas guardam apenas o UUID do segredo no cofre; o valor nunca passa
-- por uma coluna nossa.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- O Vault vem com o projeto. Se faltar, é melhor falhar aqui, com instrução,
-- do que adiante com um erro obscuro.
do $b001$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise exception using
      errcode = 'undefined_schema',
      message = 'O schema "vault" não existe neste projeto',
      hint    = 'Ative a extensão "supabase_vault" em Database > Extensions e rode de novo.';
  end if;
end;
$b001$;

-- Tudo que não é para ser tocado pelo painel mora aqui.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- -----------------------------------------------------------------------------
-- Guardar um segredo. Devolve o UUID para a tabela de destino referenciar.
--
-- Cria na primeira vez e atualiza nas seguintes, de modo que trocar um token
-- não deixa segredo órfão no cofre.
-- -----------------------------------------------------------------------------
create or replace function private.guardar_segredo(
  p_id_atual uuid,
  p_nome     text,
  p_segredo  text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $b002$
declare
  v_id uuid;
begin
  if p_segredo is null or length(trim(p_segredo)) = 0 then
    raise exception 'segredo vazio';
  end if;

  if p_id_atual is null then
    -- O nome carrega um sufixo aleatório: o Vault exige nome único, e dois
    -- pixels podem ter o mesmo rótulo.
    select vault.create_secret(
      p_segredo,
      p_nome || '_' || replace(gen_random_uuid()::text, '-', ''),
      'RRTrack'
    ) into v_id;
    return v_id;
  end if;

  perform vault.update_secret(p_id_atual, p_segredo);
  return p_id_atual;
end;
$b002$;

-- -----------------------------------------------------------------------------
-- Ler um segredo. Só o servidor chega aqui, via as funções public.get_*.
-- -----------------------------------------------------------------------------
create or replace function private.ler_segredo(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $b003$
declare
  v_segredo text;
begin
  if p_id is null then
    return null;
  end if;

  select decrypted_secret into v_segredo
    from vault.decrypted_secrets
   where id = p_id;

  return v_segredo;
end;
$b003$;

-- Apagar o segredo junto com a conta, para não acumular lixo no cofre.
create or replace function private.esquecer_segredo(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $b004$
begin
  if p_id is not null then
    delete from vault.secrets where id = p_id;
  end if;
end;
$b004$;

-- Os últimos 4 caracteres, para o painel mostrar ••••••••4f2a sem abrir o cofre.
create or replace function private.secret_last4(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $b005$
  select case
    when p_secret is null or length(p_secret) < 4 then null
    else right(p_secret, 4)
  end;
$b005$;

revoke all on function private.guardar_segredo(uuid, text, text) from public, anon, authenticated;
revoke all on function private.ler_segredo(uuid)                 from public, anon, authenticated;
revoke all on function private.esquecer_segredo(uuid)            from public, anon, authenticated;
revoke all on function private.secret_last4(text)                from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $b006$
begin
  new.updated_at := now();
  return new;
end;
$b006$;


-- ============================================================================
-- MIGRATION · 20260921120100_tabelas_config
-- ============================================================================
-- =============================================================================
-- 0002 · Configuração: settings + as contas de destino (N por tipo)
-- =============================================================================
-- Credenciais entram pelo PAINEL, não por variável de ambiente. O valor do
-- segredo vive no Supabase Vault; estas tabelas guardam só o UUID que aponta
-- para ele. O painel enxerga apenas os últimos 4 caracteres.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- settings — exatamente uma linha, garantida pelo par (pk boolean + check)
-- -----------------------------------------------------------------------------
create table if not exists public.settings (
  id                        boolean primary key default true,
  webhook_token_secret_id   uuid,
  webhook_token_last4       text,
  currency                  text not null default 'BRL',
  test_event_code           text,
  -- Origens autorizadas a chamar /api/identify e /api/event (CORS).
  allowed_origins           text[] not null default '{}',
  -- Domínio do cookie _trck. Ex.: '.transforlar.com' — vale na LP e no painel.
  cookie_domain             text,
  insights_cache_ttl_minutes integer not null default 360,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint settings_linha_unica check (id),
  constraint settings_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint settings_ttl_sensato check (insights_cache_ttl_minutes between 5 and 10080)
);

insert into public.settings (id) values (true) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Contas de destino — N linhas cada
-- -----------------------------------------------------------------------------
create table if not exists public.ga4_accounts (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  measurement_id text not null unique,
  api_secret_secret_id uuid,
  secret_last4   text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ga4_measurement_id_formato check (measurement_id ~ '^G-[A-Z0-9]+$')
);

create table if not exists public.meta_pixels (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  pixel_id       text not null unique,
  capi_token_secret_id uuid,
  secret_last4   text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint meta_pixel_id_numerico check (pixel_id ~ '^[0-9]{5,}$')
);

create table if not exists public.meta_ad_accounts (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  -- Guardado SEM o prefixo act_; quem monta a URL é o código.
  ad_account_id text not null unique,
  ads_token_secret_id uuid,
  secret_last4  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint meta_ad_account_numerico check (ad_account_id ~ '^[0-9]{5,}$')
);

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();
drop trigger if exists ga4_accounts_touch on public.ga4_accounts;
create trigger ga4_accounts_touch before update on public.ga4_accounts
  for each row execute function private.touch_updated_at();
drop trigger if exists meta_pixels_touch on public.meta_pixels;
create trigger meta_pixels_touch before update on public.meta_pixels
  for each row execute function private.touch_updated_at();
drop trigger if exists meta_ad_accounts_touch on public.meta_ad_accounts;
create trigger meta_ad_accounts_touch before update on public.meta_ad_accounts
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: o painel LÊ; escrita é só do service_role (que ignora RLS).
-- Não existe policy de INSERT/UPDATE/DELETE em lugar nenhum — de propósito.
-- -----------------------------------------------------------------------------
alter table public.settings         enable row level security;
alter table public.ga4_accounts     enable row level security;
alter table public.meta_pixels      enable row level security;
alter table public.meta_ad_accounts enable row level security;

drop policy if exists "settings: leitura autenticada" on public.settings;
create policy "settings: leitura autenticada"
  on public.settings for select to authenticated using (true);
drop policy if exists "ga4_accounts: leitura autenticada" on public.ga4_accounts;
create policy "ga4_accounts: leitura autenticada"
  on public.ga4_accounts for select to authenticated using (true);
drop policy if exists "meta_pixels: leitura autenticada" on public.meta_pixels;
create policy "meta_pixels: leitura autenticada"
  on public.meta_pixels for select to authenticated using (true);
drop policy if exists "meta_ad_accounts: leitura autenticada" on public.meta_ad_accounts;
create policy "meta_ad_accounts: leitura autenticada"
  on public.meta_ad_accounts for select to authenticated using (true);

-- O painel não precisa nem do ponteiro para o cofre. Ele lê o rótulo, o id da
-- conta e os últimos 4 caracteres — nada mais.
--
-- ATENÇÃO à regra do Postgres que engana: privilégio de COLUNA não sobrepõe
-- privilégio de TABELA. Como o Supabase concede SELECT na tabela inteira por
-- padrão, um `revoke select (coluna)` isolado NÃO surte efeito nenhum.
-- O caminho correto é revogar a tabela e devolver só as colunas não-sensíveis.
revoke all on public.settings         from anon, authenticated;
revoke all on public.ga4_accounts     from anon, authenticated;
revoke all on public.meta_pixels      from anon, authenticated;
revoke all on public.meta_ad_accounts from anon, authenticated;

grant select (
  id, webhook_token_last4, currency, test_event_code, allowed_origins,
  cookie_domain, insights_cache_ttl_minutes, created_at, updated_at
) on public.settings to authenticated;

grant select (
  id, label, measurement_id, secret_last4, is_active, created_at, updated_at
) on public.ga4_accounts to authenticated;

grant select (
  id, label, pixel_id, secret_last4, is_active, created_at, updated_at
) on public.meta_pixels to authenticated;

grant select (
  id, label, ad_account_id, secret_last4, is_active, created_at, updated_at
) on public.meta_ad_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- Gravar e ler segredo — só o service_role executa.
-- `security definer` + `search_path = ''` é a recomendação do Supabase:
-- impede que um search_path malicioso sequestre a resolução de nomes.
-- -----------------------------------------------------------------------------
create or replace function public.set_webhook_token(p_secret text)
returns void language plpgsql security definer set search_path = '' as $b011$
declare v_id uuid;
begin
  select webhook_token_secret_id into v_id from public.settings where id;
  v_id := private.guardar_segredo(v_id, 'rrtrack_webhook_token', p_secret);

  update public.settings
     set webhook_token_secret_id = v_id,
         webhook_token_last4     = private.secret_last4(p_secret)
   where id;
end;
$b011$;

create or replace function public.set_ga4_secret(p_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $b012$
declare v_id uuid;
begin
  select api_secret_secret_id into v_id from public.ga4_accounts where id = p_id;
  v_id := private.guardar_segredo(v_id, 'rrtrack_ga4', p_secret);

  update public.ga4_accounts
     set api_secret_secret_id = v_id,
         secret_last4 = private.secret_last4(p_secret)
   where id = p_id;
end;
$b012$;

create or replace function public.set_meta_pixel_secret(p_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $b013$
declare v_id uuid;
begin
  select capi_token_secret_id into v_id from public.meta_pixels where id = p_id;
  v_id := private.guardar_segredo(v_id, 'rrtrack_pixel', p_secret);

  update public.meta_pixels
     set capi_token_secret_id = v_id,
         secret_last4 = private.secret_last4(p_secret)
   where id = p_id;
end;
$b013$;

create or replace function public.set_meta_ad_account_secret(p_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $b014$
declare v_id uuid;
begin
  select ads_token_secret_id into v_id from public.meta_ad_accounts where id = p_id;
  v_id := private.guardar_segredo(v_id, 'rrtrack_ads', p_secret);

  update public.meta_ad_accounts
     set ads_token_secret_id = v_id,
         secret_last4 = private.secret_last4(p_secret)
   where id = p_id;
end;
$b014$;

create or replace function public.get_webhook_token()
returns text language sql security definer stable set search_path = '' as $b015$
  select private.ler_segredo(webhook_token_secret_id) from public.settings where id;
$b015$;

create or replace function public.get_ga4_secret(p_id uuid)
returns text language sql security definer stable set search_path = '' as $b016$
  select private.ler_segredo(api_secret_secret_id) from public.ga4_accounts where id = p_id;
$b016$;

create or replace function public.get_meta_pixel_secret(p_id uuid)
returns text language sql security definer stable set search_path = '' as $b017$
  select private.ler_segredo(capi_token_secret_id) from public.meta_pixels where id = p_id;
$b017$;

create or replace function public.get_meta_ad_account_secret(p_id uuid)
returns text language sql security definer stable set search_path = '' as $b018$
  select private.ler_segredo(ads_token_secret_id) from public.meta_ad_accounts where id = p_id;
$b018$;

do $b019$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.set_webhook_token(text)',
    'public.set_ga4_secret(uuid, text)',
    'public.set_meta_pixel_secret(uuid, text)',
    'public.set_meta_ad_account_secret(uuid, text)',
    'public.get_webhook_token()',
    'public.get_ga4_secret(uuid)',
    'public.get_meta_pixel_secret(uuid)',
    'public.get_meta_ad_account_secret(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$b019$;


-- -----------------------------------------------------------------------------
-- Apagar uma conta tira o segredo do cofre junto. Sem isso, cada conta
-- removida deixaria um token vivo no Vault para sempre.
-- -----------------------------------------------------------------------------
create or replace function private.limpar_segredo_da_conta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $b0110$
begin
  case tg_table_name
    when 'ga4_accounts'     then perform private.esquecer_segredo(old.api_secret_secret_id);
    when 'meta_pixels'      then perform private.esquecer_segredo(old.capi_token_secret_id);
    when 'meta_ad_accounts' then perform private.esquecer_segredo(old.ads_token_secret_id);
    else null;
  end case;
  return old;
end;
$b0110$;

drop trigger if exists ga4_accounts_limpa_segredo on public.ga4_accounts;
create trigger ga4_accounts_limpa_segredo after delete on public.ga4_accounts
  for each row execute function private.limpar_segredo_da_conta();
drop trigger if exists meta_pixels_limpa_segredo on public.meta_pixels;
create trigger meta_pixels_limpa_segredo after delete on public.meta_pixels
  for each row execute function private.limpar_segredo_da_conta();
drop trigger if exists meta_ad_accounts_limpa_segredo on public.meta_ad_accounts;
create trigger meta_ad_accounts_limpa_segredo after delete on public.meta_ad_accounts
  for each row execute function private.limpar_segredo_da_conta();


-- ============================================================================
-- MIGRATION · 20260921120200_tabelas_tracking
-- ============================================================================
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


-- ============================================================================
-- MIGRATION · 20260921120300_rate_limit_e_cache
-- ============================================================================
-- =============================================================================
-- 0004 · Rate limiting e cache dos Insights
-- =============================================================================
-- Rate limiting em Postgres, sem Redis: mantém a promessa de que só a infra do
-- Supabase vive em variável de ambiente.
-- =============================================================================

create table if not exists public.rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- -----------------------------------------------------------------------------
-- Incrementa e responde se PODE seguir. Atômico: o INSERT ... ON CONFLICT
-- resolve a corrida entre requisições simultâneas dentro da própria linha,
-- sem SELECT-depois-UPDATE (que deixaria janela para estourar o limite).
--
-- Devolve true quando a requisição está dentro do limite.
-- -----------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $b031$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'limite e janela precisam ser positivos';
  end if;

  -- date_bin alinha o agora ao início da janela: todas as requisições do mesmo
  -- intervalo caem na mesma linha.
  v_window := date_bin(
    make_interval(secs => p_window_seconds),
    now(),
    timestamptz 'epoch'
  );

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
    do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  return v_hits <= p_limit;
end;
$b031$;

-- Janelas vencidas não servem para nada; a Fase 8 agenda esta limpeza.
create or replace function public.purge_rate_limits(p_older_than_hours integer default 24)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $b032$
declare
  v_apagadas integer;
begin
  delete from public.rate_limits
   where window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$b032$;

-- -----------------------------------------------------------------------------
-- Cache dos Insights do Meta Ads. A Meta cobra por pontuação (BUC) e pune
-- rajada; este cache é o que permite abrir a tela de Campanhas à vontade sem
-- encostar na API.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_insights_cache (
  ad_account_id text        not null,
  level         text        not null,
  date_start    date        not null,
  date_stop     date        not null,
  data          jsonb       not null,
  fetched_at    timestamptz not null default now(),
  primary key (ad_account_id, level, date_start, date_stop),
  constraint meta_insights_level_valido check (level in ('campaign', 'adset', 'ad')),
  constraint meta_insights_periodo_valido check (date_start <= date_stop)
);

create index if not exists meta_insights_fetched_idx on public.meta_insights_cache (fetched_at);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.rate_limits         enable row level security;
alter table public.meta_insights_cache enable row level security;

-- rate_limits não tem policy nenhuma: nem o painel precisa ler. Com RLS ligada
-- e zero policies, ninguém alcança a tabela a não ser o service_role.
drop policy if exists "meta_insights_cache: leitura autenticada" on public.meta_insights_cache;
create policy "meta_insights_cache: leitura autenticada"
  on public.meta_insights_cache for select to authenticated using (true);

revoke all on public.rate_limits from anon, authenticated;
revoke insert, update, delete, truncate
  on public.meta_insights_cache from anon, authenticated;
revoke all on public.meta_insights_cache from anon;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.purge_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.purge_rate_limits(integer) to service_role;


-- ============================================================================
-- MIGRATION · 20260921120400_dominios_checkout
-- ============================================================================
-- =============================================================================
-- 0005 · Domínios de checkout configuráveis
-- =============================================================================
-- O snippet marca com o trck_user_id todo link que aponta para o checkout —
-- é essa a ponte cross-domain, já que o checkout é outro site.
--
-- A lista NASCEU dentro do snippet, com as plataformas de infoproduto
-- (hotmart, kiwify, eduzz…). Estava errada por dois motivos:
--
--   1. a primeira loja é Shopify com checkout de terceiro, e nenhum daqueles
--      domínios aparece no funil dela;
--   2. cada oferta futura usa o checkout que quiser, e trocar isso não pode
--      exigir deploy.
--
-- Agora é configuração. O WhatsApp continua no código porque é universal e
-- porque o mecanismo é outro: lá o id vai no TEXTO da mensagem, não na query.
-- =============================================================================

alter table public.settings
  add column if not exists checkout_domains text[] not null default '{}';

comment on column public.settings.checkout_domains is
  'Domínios do checkout. O snippet marca com trck_user_id todo link que aponte para um deles. Ex.: {seguro.pagou.ai, checkout.minhaloja.com}';

-- O painel lê a coluna nova. Como o SELECT da tabela foi revogado e devolvido
-- coluna a coluna (ver 0002), uma coluna nova NÃO é visível por herança:
-- precisa do grant explícito, ou a tela quebra com "permission denied".
grant select (checkout_domains) on public.settings to authenticated;


-- ============================================================================
-- MIGRATION · 20260921120500_webhooks_recebidos
-- ============================================================================
-- =============================================================================
-- 0006 · webhooks_recebidos — nada que chega se perde
-- =============================================================================
-- A rota de webhook só entendia Appmax e Pagou. Qualquer outro formato levava
-- 202 e era DESCARTADO: se a loja apontasse um checkout novo para cá, a venda
-- sumia e ninguém ficava sabendo.
--
-- Agora tudo que chega é gravado aqui ANTES de qualquer interpretação. Duas
-- consequências:
--
--   1. Nenhuma venda se perde enquanto o adaptador daquele checkout não
--      existe — dá para reprocessar depois, com o payload original.
--   2. O formato real fica VISÍVEL no painel. É assim que se escreve o
--      adaptador certo: contra o payload que chegou, não contra documentação.
--
-- É a resposta para "ainda não sei qual checkout vou usar": em vez de quatro
-- adaptadores adivinhados, um lugar onde o payload de verdade aparece.
-- =============================================================================

create table if not exists public.webhooks_recebidos (
  id           uuid primary key default gen_random_uuid(),

  -- Qual adaptador reconheceu. NULL = ninguém reconheceu, e é justamente
  -- esse o caso que interessa olhar.
  adaptador    text,

  -- O corpo exatamente como chegou. jsonb quando é JSON válido; quando não
  -- é, fica em `corpo_texto` — payload quebrado também é informação.
  corpo        jsonb,
  corpo_texto  text,

  -- Cabeçalhos, para descobrir como o gateway assina. O header da assinatura
  -- da MillionsPay e o X-Adoorei-hash aparecem aqui.
  headers      jsonb,

  ip           inet,
  -- Preenchido quando virou venda, para ligar as duas pontas.
  transaction_id text,

  created_at   timestamptz not null default now()
);

create index if not exists webhooks_recebidos_created_idx
  on public.webhooks_recebidos (created_at desc);

-- O índice que importa: achar rápido o que NINGUÉM reconheceu.
create index if not exists webhooks_recebidos_desconhecidos_idx
  on public.webhooks_recebidos (created_at desc) where adaptador is null;

-- -----------------------------------------------------------------------------
-- RLS — mesma regra de sempre: o painel lê, só o service_role escreve.
-- -----------------------------------------------------------------------------
alter table public.webhooks_recebidos enable row level security;

drop policy if exists "webhooks_recebidos: leitura autenticada" on public.webhooks_recebidos;
create policy "webhooks_recebidos: leitura autenticada"
  on public.webhooks_recebidos for select to authenticated using (true);

revoke insert, update, delete, truncate
  on public.webhooks_recebidos from anon, authenticated;
revoke all on public.webhooks_recebidos from anon;


-- ============================================================================
-- MIGRATION · 20260921120600_estorno
-- ============================================================================
-- =============================================================================
-- 0007 · reverted_at — a marca de que o estorno já foi desfeito nos destinos
-- =============================================================================
-- `sent_at` responde "já mandei a venda?". Faltava o par: "já desfiz?".
--
-- Sem essa marca, cada reenvio do evento de estorno — e os gateways reenviam,
-- a Appmax até quatro vezes — mandaria outro `refund` ao GA4, e a receita
-- ficaria negativa em cima de uma venda só.
-- =============================================================================

alter table public.purchases
  add column if not exists reverted_at timestamptz;

comment on column public.purchases.reverted_at is
  'Quando o estorno foi comunicado aos destinos. NULL = ainda não. Par do sent_at.';

-- Fila de quem foi enviado e depois estornado, mas ainda não desfeito.
create index if not exists purchases_a_desfazer_idx
  on public.purchases (created_at)
  where sent_at is not null and reverted_at is null;


-- ============================================================================
-- MIGRATION · 20260922100000_status_por_alias
-- ============================================================================
-- =============================================================================
-- 0008 · Aliases de status configuráveis, e o motivo de um webhook não virar venda
-- =============================================================================
-- Duas mudanças, e as duas nasceram da mesma descoberta.
--
-- O suporte da Yampi confirmou (22/09/2026) que os aliases de status
-- **são configuráveis por loja**: não existe lista fixa, e a única forma de
-- saber os da sua loja é chamar `GET /{alias}/checkout/statuses`. Uma loja
-- pode renomear o estorno para `devolvido`, ou criar `em_separacao`.
--
-- Isso invalida um mapa fixo no código. É a mesma regra que já vale para a
-- Appmax: decidir por um campo cuja enumeração ninguém conhece é escolher
-- ser surpreendido. Lá a saída foi decidir pelo EVENTO; aqui o evento não
-- basta, porque `order.status.updated` só diz "mudou" — o alias é que diz
-- para quê. Então o mapa vira CONFIGURAÇÃO, como os domínios do checkout.
--
-- O estrago que isso evita é específico: um alias de estorno que não bate
-- com o nosso chute faria o refund NUNCA chegar ao GA4, e o faturamento
-- ficaria inflado por uma venda que voltou para o cliente.
--
-- A segunda mudança é a rede de segurança. Até agora, "reconheci e ignorei
-- de propósito" (nota fiscal) e "reconheci e não soube o que fazer" (alias
-- desconhecido) ficavam IGUAIS no painel: badge verde com o nome do
-- adaptador. O primeiro é normal; o segundo é uma venda possivelmente
-- perdida. Agora o motivo fica gravado, e a tela pode distinguir.
-- =============================================================================

alter table public.settings
  add column if not exists status_aliases text[] not null default '{}';

comment on column public.settings.status_aliases is
  'Mapa alias -> status, um por linha, no formato "alias = status". Os aliases de status da Yampi são configuráveis por loja (GET /{alias}/checkout/statuses), então não podem morar no código. Ex.: {"devolvido = estornada", "em_separacao = pendente"}';

-- Coluna nova NÃO é visível por herança: o SELECT desta tabela foi revogado
-- e devolvido coluna a coluna (ver 0002). Sem o grant, a tela de
-- configuração quebra com "permission denied".
grant select (status_aliases) on public.settings to authenticated;

alter table public.webhooks_recebidos
  add column if not exists motivo text;

comment on column public.webhooks_recebidos.motivo is
  'Por que o payload não virou venda. NULL quando virou, ou quando nenhum adaptador reconheceu. Distingue "ignorado de propósito" de "não soube ler" — o segundo é venda possivelmente perdida e precisa aparecer no painel.';


-- ============================================================================
-- MIGRATION · 20260922140000_valor_estornado
-- ============================================================================
-- =============================================================================
-- 0009 · reverted_value — o estorno parcial não pode comer a venda inteira
-- =============================================================================
-- `purchases.value` é o que o cliente PAGOU. O evento de estorno também traz
-- um valor — e aí está o problema: não se sabe, sem ler a documentação de
-- cada gateway, se aquele valor é o total original ou só o pedaço devolvido.
--
-- Nenhuma das cinco documentações diz. E as duas leituras erram de formas
-- opostas, as duas caladas:
--
--   · se o gateway manda o PEDAÇO e a gente grava em `value`, a venda de
--     R$ 200 com estorno de R$ 20 passa a valer R$ 20 no faturamento;
--   · se o gateway manda o TOTAL e a gente manda esse total ao GA4 como
--     refund de um estorno parcial, subtrai R$ 200 de uma devolução de R$ 20.
--
-- A saída não passa por descobrir qual é: são colunas separadas, e aí as
-- duas perguntas têm resposta independente. `value` é da venda e nenhum
-- evento de reversão mexe nele; `reverted_value` é o que o evento de
-- reversão trouxe, e é ele que vai ao GA4 — caindo para `value` quando o
-- gateway não informa nada, que é a única suposição disponível.
--
-- Funciona sem saber o que cada gateway faz, o que é o ponto.
-- =============================================================================

alter table public.purchases
  add column if not exists reverted_value numeric(14,2);

comment on column public.purchases.reverted_value is
  'Valor que o evento de reversão trouxe. NULL = o gateway não informou, e aí o refund usa o value da venda. Separado de `value` porque estorno parcial existe e nenhum gateway documenta a unidade: sem a separação, um lado dos dois sempre erra.';

grant select (reverted_value) on public.purchases to authenticated;


-- ============================================================================
-- MIGRATION · 20260922160000_consultas_do_painel
-- ============================================================================
-- =============================================================================
-- 0010 · As consultas agregadas do painel
-- =============================================================================
-- O PostgREST não faz `group by` nem `sum`. Sem isto o painel baixaria as
-- linhas e somaria em JavaScript — funciona com cem linhas e derruba a tela
-- com cem mil. Agregação é trabalho de banco.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ São FUNÇÕES, não views, e o motivo é o FUSO.                              │
-- │                                                                           │
-- │ Uma view com bucket diário tem de escolher um fuso na hora de ser criada, │
-- │ e a única escolha disponível ali é UTC. A Vercel roda em UTC; quem olha o │
-- │ painel está em São Paulo, UTC-3. "Receita de hoje" mostraria só o que     │
-- │ entrou depois das 21h de ontem, e o dia de vendas apareceria rachado em   │
-- │ duas linhas.                                                              │
-- │                                                                           │
-- │ Pior: o número não bateria com o painel do gateway, que conta em fuso     │
-- │ local — e ninguém saberia por quê. É o ROAS fantasma em miniatura, que é  │
-- │ exatamente o que este sistema existe para não fazer.                      │
-- │                                                                           │
-- │ Com função, o fuso e o intervalo são PARÂMETROS: quem sabe o fuso é o     │
-- │ app, e o banco só soma entre dois instantes.                              │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Nenhuma é `security definer`. São `stable` e rodam com os privilégios de
-- QUEM CHAMA, então a RLS de `authenticated` vale igual — uma função
-- `definer` aqui devolveria agregado de dados que a política nega, sem erro
-- e sem aviso. A asserção 8 do teste de segurança guarda isso.
-- =============================================================================

-- O fuso do painel é configuração: a primeira oferta é brasileira, mas a
-- próxima pode não ser, e o número certo depende disso.
alter table public.settings
  add column if not exists timezone text not null default 'America/Sao_Paulo';

comment on column public.settings.timezone is
  'Fuso em que o painel agrupa os dias. UTC racharia o dia de vendas em duas linhas e o total não bateria com o painel do gateway.';

grant select (timezone) on public.settings to authenticated;

-- -----------------------------------------------------------------------------
-- O resumo do período — uma linha com tudo que vira cartão de métrica
-- -----------------------------------------------------------------------------
-- `ate` é EXCLUSIVO (`< ate`), não inclusivo: com `<=` o último milissegundo
-- do dia entraria em dois períodos ao mesmo tempo, e "hoje" + "ontem" somados
-- dariam mais que os dois dias juntos.
create or replace function public.painel_resumo(de timestamptz, ate timestamptz)
returns table (
  visitantes      bigint,
  identificados   bigint,
  eventos         bigint,
  aprovadas       bigint,
  receita         numeric,
  pendentes       bigint,
  recusadas       bigint,
  estornadas      bigint,
  devolvido       numeric,
  atribuidas      bigint,
  sem_atribuicao  bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (select count(*) from public.visitors v
      where v.created_at >= de and v.created_at < ate),
    (select count(*) from public.visitors v
      where v.created_at >= de and v.created_at < ate
        and v.email_hash is not null),
    (select count(*) from public.events_log e
      where e.created_at >= de and e.created_at < ate),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada'),
    -- A receita que VALE é só a aprovada. Somar pendente contaria boleto que
    -- ninguém pagou; somar estornada contaria dinheiro que voltou.
    (select coalesce(sum(p.value), 0) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada'),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'pendente'),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'recusada'),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status in ('estornada', 'chargeback')),
    -- O que voltou. `reverted_value` quando o gateway informou o pedaço;
    -- senão o valor da venda, que é o estorno total.
    (select coalesce(sum(coalesce(p.reverted_value, p.value)), 0)
       from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status in ('estornada', 'chargeback')),
    -- Quantas vendas casaram com um visitante. É a saúde da atribuição: se
    -- isto cai, o ROAS por campanha está ficando cego.
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada' and p.trck_user_id is not null),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada' and p.trck_user_id is null);
$$;

comment on function public.painel_resumo(timestamptz, timestamptz) is
  'Os totais do período. `ate` é exclusivo. Receita só de status aprovada — pendente é boleto que ninguém pagou, estornada é dinheiro que voltou.';

-- -----------------------------------------------------------------------------
-- Eventos por tipo — a quebra, e a etapa do meio do funil
-- -----------------------------------------------------------------------------
create or replace function public.painel_eventos_por_tipo(de timestamptz, ate timestamptz)
returns table (
  event_name  text,
  total       bigint,
  visitantes  bigint
)
language sql
stable
set search_path = ''
as $$
  select
    e.event_name,
    count(*),
    -- Distinto DENTRO do período. É o que o funil precisa: a pessoa que
    -- abriu o checkout três vezes é uma pessoa, não três.
    count(distinct e.trck_user_id)
  from public.events_log e
  where e.created_at >= de and e.created_at < ate
  group by e.event_name
  order by 2 desc;
$$;

-- -----------------------------------------------------------------------------
-- A série diária — o gráfico
-- -----------------------------------------------------------------------------
-- O `fuso` entra como parâmetro porque é o app que sabe dele. `generate_series`
-- devolve os dias VAZIOS também: sem isso o gráfico pularia o dia sem venda e
-- a linha mentiria sobre a forma da curva.
create or replace function public.painel_serie_diaria(
  de timestamptz,
  ate timestamptz,
  fuso text default 'America/Sao_Paulo'
)
returns table (
  dia         date,
  visitantes  bigint,
  eventos     bigint,
  aprovadas   bigint,
  receita     numeric
)
language sql
stable
set search_path = ''
as $$
  with dias as (
    select d::date as dia
    from generate_series(
      (de  at time zone fuso)::date,
      (ate at time zone fuso)::date - 1,
      interval '1 day'
    ) as d
  )
  select
    dias.dia,
    coalesce(v.total, 0),
    coalesce(e.total, 0),
    coalesce(c.pedidos, 0),
    coalesce(c.receita, 0)
  from dias
  left join (
    select (created_at at time zone fuso)::date as dia, count(*) as total
    from public.visitors
    where created_at >= de and created_at < ate
    group by 1
  ) v on v.dia = dias.dia
  left join (
    select (created_at at time zone fuso)::date as dia, count(*) as total
    from public.events_log
    where created_at >= de and created_at < ate
    group by 1
  ) e on e.dia = dias.dia
  left join (
    select
      (created_at at time zone fuso)::date as dia,
      count(*)                             as pedidos,
      coalesce(sum(value), 0)              as receita
    from public.purchases
    where created_at >= de and created_at < ate and status = 'aprovada'
    group by 1
  ) c on c.dia = dias.dia
  order by dias.dia;
$$;

comment on function public.painel_serie_diaria(timestamptz, timestamptz, text) is
  'Série por dia no fuso pedido, com os dias vazios inclusos — sem eles o gráfico pularia o dia sem venda e a curva mentiria.';

-- -----------------------------------------------------------------------------
-- Geo — visitante e venda na mesma linha, por região
-- -----------------------------------------------------------------------------
-- `full outer join` de propósito: o mapa precisa distinguir "visitou e não
-- comprou" de "comprou" — e venda sem visitante casado existe (é a venda
-- órfã), então os dois lados podem ter linha que o outro não tem.
create or replace function public.painel_geo(de timestamptz, ate timestamptz)
returns table (
  pais        text,
  regiao      text,
  visitantes  bigint,
  aprovadas   bigint,
  receita     numeric
)
language sql
stable
set search_path = ''
as $$
  with v as (
    select geo_country as pais, geo_region as regiao, count(*) as total
    from public.visitors
    where created_at >= de and created_at < ate and geo_country is not null
    group by 1, 2
  ),
  c as (
    select
      geo_country              as pais,
      geo_region               as regiao,
      count(*)                 as pedidos,
      coalesce(sum(value), 0)  as receita
    from public.purchases
    where created_at >= de and created_at < ate
      and geo_country is not null and status = 'aprovada'
    group by 1, 2
  )
  select
    coalesce(v.pais, c.pais),
    coalesce(v.regiao, c.regiao),
    coalesce(v.total, 0),
    coalesce(c.pedidos, 0),
    coalesce(c.receita, 0)
  from v
  full outer join c on c.pais = v.pais and c.regiao is not distinct from v.regiao
  order by 5 desc, 3 desc;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------
-- Função nova em `public` nasce com `execute` para PUBLIC — que inclui `anon`,
-- o role da chave que vai no bundle do navegador. Revoga e devolve só a quem
-- entrou. Foi a asserção 3c do teste que pegou o equivalente para views.
revoke all on function public.painel_resumo(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.painel_eventos_por_tipo(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.painel_serie_diaria(timestamptz, timestamptz, text)
  from public, anon;
revoke all on function public.painel_geo(timestamptz, timestamptz)
  from public, anon;

grant execute on function public.painel_resumo(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.painel_eventos_por_tipo(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.painel_serie_diaria(timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.painel_geo(timestamptz, timestamptz)
  to authenticated;


-- ============================================================================
-- MIGRATION · 20260925120000_receita_por_utm
-- ============================================================================
-- =============================================================================
-- 0011 · Receita por UTM — o outro lado do ROAS
-- =============================================================================
-- O gasto vem da Meta; a receita vem daqui. O que os cruza é a UTM de
-- campanha, e é por isso que ela precisa ser agregada no banco: o painel não
-- pode baixar toda venda para somar em JavaScript.
--
-- **Só `aprovada`.** É a regra do projeto inteira em uma linha: pendente é
-- boleto que ninguém pagou, estornada é dinheiro que voltou. O ROAS que vale
-- é sobre o que ficou no caixa — e é ele que vai divergir do da Meta, que
-- não tem reversão.
--
-- `sem_atribuicao` conta à parte, e não é detalhe: é receita real que NÃO
-- entra em campanha nenhuma. Sem esse número, o ROAS parece pior do que é e
-- ninguém sabe o quanto.
-- =============================================================================

create or replace function public.painel_receita_por_utm(
  de timestamptz,
  ate timestamptz
)
returns table (
  utm_campaign  text,
  utm_source    text,
  vendas        bigint,
  receita       numeric
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(p.utm_campaign, ''),
    coalesce(p.utm_source, ''),
    count(*),
    coalesce(sum(p.value), 0)
  from public.purchases p
  where p.created_at >= de
    and p.created_at <  ate
    and p.status = 'aprovada'
  group by 1, 2
  order by 4 desc;
$$;

comment on function public.painel_receita_por_utm(timestamptz, timestamptz) is
  'Receita aprovada por utm_campaign e utm_source. A campanha vazia agrupa a venda sem atribuição — que é receita real fora de campanha nenhuma.';

-- Função nova em `public` nasce com `execute` para PUBLIC, que inclui `anon`
-- — o role da chave que vai no bundle do navegador. Ver a asserção 8.
revoke all on function public.painel_receita_por_utm(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.painel_receita_por_utm(timestamptz, timestamptz)
  to authenticated;


-- ============================================================================
-- MIGRATION · 20260925140000_retencao
-- ============================================================================
-- =============================================================================
-- 0012 · Retenção — o que sai, o que fica, e por quê
-- =============================================================================
-- Três tabelas guardam payload cru, e payload cru é o que cresce sem limite:
-- um evento de captura tem quatro jsonb, e um webhook de venda traz o cliente
-- inteiro. Em seis meses de tráfego isso é a maior parte do banco.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A LINHA NUNCA É APAGADA. Só os campos pesados são zerados.               │
-- │                                                                           │
-- │ Data, nome do evento, UTMs e geo continuam alimentando o painel — o      │
-- │ histórico de conversão e de ROAS não pode encolher só porque o payload   │
-- │ envelheceu. Apagar a linha reescreveria o passado do faturamento.        │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- E há um segundo motivo, que não é de espaço: esses campos guardam **dado
-- pessoal** — e-mail, telefone, endereço, CPF em alguns gateways. Guardar
-- para sempre o que só serve para depurar a primeira semana é risco sem
-- contrapartida. Aqui, minimizar é a escolha certa pelos dois lados.
--
-- Prazos, e a razão de cada um:
--
--   events_log          14 dias  · depurar envio é trabalho da mesma semana
--   webhooks_recebidos  30 dias  · é com ele que se escreve adaptador novo,
--                                   e adaptador leva mais que uma semana
--   purchases.raw       90 dias  · auditoria de venda contestada. O prazo de
--                                   chargeback no cartão chega a 120 dias,
--                                   então 90 é o mínimo defensável — mas a
--                                   LINHA da venda fica para sempre
-- =============================================================================

/*
 * O `pg_cron` existe no Supabase e NÃO num Postgres comum. O bloco tolera a
 * ausência para a migration rodar inteira no teste local — a função de
 * limpeza, que é onde mora a lógica, é criada dos dois lados. O agendamento
 * se verifica no Supabase, em `cron.job` e `cron.job_run_details`.
 */
do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when others then
    raise notice 'pg_cron indisponível (esperado fora do Supabase): %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- A rotina
-- -----------------------------------------------------------------------------
-- `security definer` porque o cron roda sem usuário e precisa escrever nas
-- três tabelas — que não têm policy de escrita para ninguém, por desenho.
create or replace function private.aplicar_retencao(p_lote integer default 5000)
returns table (tabela text, linhas bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  /*
   * EM LOTES, e `purged_at` é o que torna isso possível.
   *
   * Um UPDATE sobre seis meses de eventos trava a tabela por minutos e a
   * captura para de gravar — o site inteiro perde tracking enquanto a
   * limpeza roda. Com lote e marca, cada passagem é curta e a seguinte
   * continua de onde parou.
   */
  with alvo as (
    select id from public.events_log
     where created_at < now() - interval '14 days'
       and purged_at is null
     order by created_at
     limit p_lote
     for update skip locked
  )
  update public.events_log e
     set payload_meta  = null,
         response_meta = null,
         payload_ga4   = null,
         response_ga4  = null,
         purged_at     = now()
    from alvo
   where e.id = alvo.id;

  get diagnostics v_n = row_count;
  tabela := 'events_log'; linhas := v_n; return next;

  with alvo as (
    select id from public.webhooks_recebidos
     where created_at < now() - interval '30 days'
       and (corpo is not null or corpo_texto is not null or headers is not null)
     order by created_at
     limit p_lote
     for update skip locked
  )
  update public.webhooks_recebidos w
     set corpo = null, corpo_texto = null, headers = null
    from alvo
   where w.id = alvo.id;

  get diagnostics v_n = row_count;
  tabela := 'webhooks_recebidos'; linhas := v_n; return next;

  with alvo as (
    select id from public.purchases
     where created_at < now() - interval '90 days'
       and raw_webhook is not null
     order by created_at
     limit p_lote
     for update skip locked
  )
  update public.purchases p
     set raw_webhook = null
    from alvo
   where p.id = alvo.id;

  get diagnostics v_n = row_count;
  tabela := 'purchases'; linhas := v_n; return next;
end;
$$;

comment on function private.aplicar_retencao(integer) is
  'Zera os campos pesados fora do prazo, em lotes. NUNCA apaga linha: data, evento, UTMs e geo seguem alimentando o painel.';

revoke all on function private.aplicar_retencao(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- O agendamento
-- -----------------------------------------------------------------------------
-- 04:10 UTC = 01:10 em São Paulo — fora do pico de qualquer oferta brasileira.
-- Um lote por dia basta: o volume diário é muito menor que 5.000 e a fila
-- nunca acumula. Se acumular, o índice parcial acha o que falta rápido.
do $$
begin
  perform cron.unschedule('rrtrack-retencao');
exception
  when others then null;  -- não existia ainda, ou não há pg_cron aqui
end;
$$;

do $$
begin
  perform cron.schedule(
    'rrtrack-retencao',
    '10 4 * * *',
    'select private.aplicar_retencao();'
  );
exception
  when undefined_function or invalid_schema_name then
    -- Substituto de teste: agenda na tabela falsa só para a asserção ver.
    perform extensions.cron_schedule(
      'rrtrack-retencao',
      '10 4 * * *',
      'select private.aplicar_retencao();'
    );
end;
$$;


-- ============================================================================
-- VERIFICAÇÃO FINAL · o relatório que diz se deu certo
-- ============================================================================
do $inst9$
declare
  v_tabelas        integer;
  v_sem_rls        text[];
  v_policy_escrita integer;
  v_id             uuid;
  v_lido           text;
  v_ponteiro       uuid;
  v_ok             boolean := true;
begin
  raise notice '';
  raise notice '═══════════════════════════════════════════════════════';
  raise notice '  RRTrack · relatório de instalação';
  raise notice '═══════════════════════════════════════════════════════';

  -- Confere as tabelas pelo NOME, não pela contagem. Contagem quebra a cada
  -- migration nova sem dizer o que faltou; nome diz exatamente qual sumiu.
  select array_agg(t) into v_sem_rls from unnest(array[
    'settings', 'ga4_accounts', 'meta_pixels', 'meta_ad_accounts',
    'visitors', 'events_log', 'purchases',
    'rate_limits', 'meta_insights_cache', 'webhooks_recebidos'
  ]) as t
  where not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = t
  );

  select count(*) into v_tabelas from pg_tables where schemaname = 'public';

  if v_sem_rls is null then
    raise notice '  [ok]    % tabelas criadas', v_tabelas;
  else
    raise notice '  [FALHA] faltaram tabelas: %', v_sem_rls;
    v_ok := false;
  end if;
  v_sem_rls := null;

  select array_agg(c.relname order by c.relname) into v_sem_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_sem_rls is null then
    raise notice '  [ok]    RLS ligada em todas as tabelas';
  else
    raise notice '  [FALHA] sem RLS: %', v_sem_rls;
    v_ok := false;
  end if;

  select count(*) into v_policy_escrita
    from pg_policies where schemaname = 'public' and cmd <> 'SELECT';
  if v_policy_escrita = 0 then
    raise notice '  [ok]    Nenhuma policy de escrita (só service_role grava)';
  else
    raise notice '  [FALHA] % policy(s) de escrita encontradas', v_policy_escrita;
    v_ok := false;
  end if;

  if has_column_privilege('authenticated', 'public.meta_pixels', 'capi_token_secret_id', 'SELECT')
     or has_column_privilege('anon', 'public.settings', 'webhook_token_secret_id', 'SELECT') then
    raise notice '  [FALHA] ponteiro de segredo legível pelo painel';
    v_ok := false;
  else
    raise notice '  [ok]    Segredos fora do alcance do painel';
  end if;

  insert into public.meta_pixels (label, pixel_id)
  values ('__verificacao__', '999999999') returning id into v_id;

  perform public.set_meta_pixel_secret(v_id, 'token-de-verificacao-1234');
  select public.get_meta_pixel_secret(v_id) into v_lido;
  select capi_token_secret_id into v_ponteiro from public.meta_pixels where id = v_id;

  if v_lido = 'token-de-verificacao-1234' and v_ponteiro is not null then
    raise notice '  [ok]    Cofre guarda e devolve o segredo';
  else
    raise notice '  [FALHA] o cofre não fechou o ciclo';
    v_ok := false;
  end if;

  -- Apagar a conta tem que levar o segredo junto, senão sobra token vivo.
  delete from public.meta_pixels where id = v_id;
  if exists (select 1 from vault.secrets where id = v_ponteiro) then
    raise notice '  [FALHA] o segredo ficou no cofre depois de apagar a conta';
    v_ok := false;
  else
    raise notice '  [ok]    Apagar a conta remove o segredo do cofre';
  end if;

  if public.check_rate_limit('__verificacao__', 1, 60)
     and not public.check_rate_limit('__verificacao__', 1, 60) then
    raise notice '  [ok]    Rate limit corta no limite';
  else
    raise notice '  [FALHA] rate limit não está cortando';
    v_ok := false;
  end if;
  delete from public.rate_limits where bucket = '__verificacao__';

  raise notice '═══════════════════════════════════════════════════════';
  if v_ok then
    raise notice '  TUDO CERTO. Pode seguir para o passo seguinte.';
  else
    raise notice '  ALGO FALHOU — me mande este relatório.';
  end if;
  raise notice '═══════════════════════════════════════════════════════';
  raise notice '';
end;
$inst9$;
