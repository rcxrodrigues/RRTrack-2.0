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
-- PARTE 0 · Chave de cifra
-- ----------------------------------------------------------------------------
-- Gera a chave DENTRO do banco e grava no catálogo do Postgres. Ela nunca
-- aparece na tela: não há como vazá-la por descuido. Se já existir uma, é
-- mantida — senão os segredos já cifrados ficariam ilegíveis.
-- ============================================================================
do $$
declare
  v_chave text;
begin
  v_chave := current_setting('app.settings.encryption_key', true);

  if v_chave is null or length(v_chave) < 32 then
    v_chave := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    execute format(
      'alter database %I set app.settings.encryption_key = %L',
      current_database(), v_chave
    );
    raise notice 'Chave de cifra criada (64 caracteres).';
  else
    raise notice 'Chave de cifra já existia — mantida.';
  end if;

  -- Vale para esta sessão também, para as verificações do fim rodarem agora.
  perform set_config('app.settings.encryption_key', v_chave, false);
end;
$$;


-- ============================================================================
-- MIGRATION · 20260921120000_extensoes_e_cifra
-- ============================================================================
-- =============================================================================
-- 0001 · Extensões, schema privado e a cifra dos segredos (pgcrypto)
-- =============================================================================
-- A chave de cifra NÃO fica em nenhuma tabela. Ela fica no catálogo do
-- Postgres, definida uma única vez por:
--
--   ALTER DATABASE postgres SET app.settings.encryption_key = '<chave forte>';
--
-- Assim, um dump das tabelas de dados não decifra nada. Ver o limite dessa
-- escolha no CLAUDE.md (um pg_dumpall leva a chave junto).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Tudo que não é para ser tocado pelo painel mora aqui.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- -----------------------------------------------------------------------------
-- A chave. Falha alto e claro se não estiver configurada — melhor um erro
-- explícito do que gravar um segredo com chave vazia.
-- -----------------------------------------------------------------------------
create or replace function private.encryption_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  v_key := current_setting('app.settings.encryption_key', true);

  if v_key is null or length(v_key) < 32 then
    raise exception using
      errcode = 'config_file_error',
      message = 'app.settings.encryption_key ausente ou com menos de 32 caracteres',
      hint    = 'Rode: ALTER DATABASE postgres SET app.settings.encryption_key = ''<chave com 32+ caracteres>''; e depois reconecte.';
  end if;

  return v_key;
end;
$$;

create or replace function private.encrypt_secret(p_secret text)
returns bytea
language sql
volatile
security definer
set search_path = ''
as $$
  select extensions.pgp_sym_encrypt(p_secret, private.encryption_key());
$$;

create or replace function private.decrypt_secret(p_enc bytea)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_enc is null then null
    else extensions.pgp_sym_decrypt(p_enc, private.encryption_key())
  end;
$$;

-- Os últimos 4 caracteres, para o painel mostrar ••••••••4f2a sem decifrar.
create or replace function private.secret_last4(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_secret is null or length(p_secret) < 4 then null
    else right(p_secret, 4)
  end;
$$;

revoke all on function private.encryption_key() from public, anon, authenticated;
revoke all on function private.encrypt_secret(text) from public, anon, authenticated;
revoke all on function private.decrypt_secret(bytea) from public, anon, authenticated;
revoke all on function private.secret_last4(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ============================================================================
-- MIGRATION · 20260921120100_tabelas_config
-- ============================================================================
-- =============================================================================
-- 0002 · Configuração: settings + as contas de destino (N por tipo)
-- =============================================================================
-- Credenciais entram pelo PAINEL, não por variável de ambiente. Os segredos
-- ficam cifrados em coluna bytea; o painel só enxerga os últimos 4 caracteres.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- settings — exatamente uma linha, garantida pelo par (pk boolean + check)
-- -----------------------------------------------------------------------------
create table if not exists public.settings (
  id                        boolean primary key default true,
  webhook_token_enc         bytea,
  webhook_token_last4       text,
  currency                  text not null default 'BRL',
  test_event_code           text,
  -- Origens autorizadas a chamar /api/identify e /api/event (CORS).
  allowed_origins           text[] not null default '{}',
  -- Domínio do cookie _trck. Ex.: '.oferta.com' — vale na LP e no painel.
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
  api_secret_enc bytea,
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
  capi_token_enc bytea,
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
  ads_token_enc bytea,
  secret_last4  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint meta_ad_account_numerico check (ad_account_id ~ '^[0-9]{5,}$')
);

create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();
create trigger ga4_accounts_touch before update on public.ga4_accounts
  for each row execute function private.touch_updated_at();
create trigger meta_pixels_touch before update on public.meta_pixels
  for each row execute function private.touch_updated_at();
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

create policy "settings: leitura autenticada"
  on public.settings for select to authenticated using (true);
create policy "ga4_accounts: leitura autenticada"
  on public.ga4_accounts for select to authenticated using (true);
create policy "meta_pixels: leitura autenticada"
  on public.meta_pixels for select to authenticated using (true);
create policy "meta_ad_accounts: leitura autenticada"
  on public.meta_ad_accounts for select to authenticated using (true);

-- Defesa em profundidade: mesmo cifradas, as colunas de segredo ficam fora do
-- alcance do painel.
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
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.settings
     set webhook_token_enc   = private.encrypt_secret(p_secret),
         webhook_token_last4 = private.secret_last4(p_secret)
   where id;
end;
$$;

create or replace function public.set_ga4_secret(p_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ga4_accounts
     set api_secret_enc = private.encrypt_secret(p_secret),
         secret_last4   = private.secret_last4(p_secret)
   where id = p_id;
end;
$$;

create or replace function public.set_meta_pixel_secret(p_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.meta_pixels
     set capi_token_enc = private.encrypt_secret(p_secret),
         secret_last4   = private.secret_last4(p_secret)
   where id = p_id;
end;
$$;

create or replace function public.set_meta_ad_account_secret(p_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.meta_ad_accounts
     set ads_token_enc = private.encrypt_secret(p_secret),
         secret_last4  = private.secret_last4(p_secret)
   where id = p_id;
end;
$$;

create or replace function public.get_webhook_token()
returns text language sql security definer stable set search_path = '' as $$
  select private.decrypt_secret(webhook_token_enc) from public.settings where id;
$$;

create or replace function public.get_ga4_secret(p_id uuid)
returns text language sql security definer stable set search_path = '' as $$
  select private.decrypt_secret(api_secret_enc) from public.ga4_accounts where id = p_id;
$$;

create or replace function public.get_meta_pixel_secret(p_id uuid)
returns text language sql security definer stable set search_path = '' as $$
  select private.decrypt_secret(capi_token_enc) from public.meta_pixels where id = p_id;
$$;

create or replace function public.get_meta_ad_account_secret(p_id uuid)
returns text language sql security definer stable set search_path = '' as $$
  select private.decrypt_secret(ads_token_enc) from public.meta_ad_accounts where id = p_id;
$$;

do $$
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
$$;


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

create trigger visitors_touch before update on public.visitors
  for each row execute function private.touch_updated_at();
create trigger purchases_touch before update on public.purchases
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — mesma regra: painel lê, só o service_role escreve.
-- -----------------------------------------------------------------------------
alter table public.visitors   enable row level security;
alter table public.events_log enable row level security;
alter table public.purchases  enable row level security;

create policy "visitors: leitura autenticada"
  on public.visitors for select to authenticated using (true);
create policy "events_log: leitura autenticada"
  on public.events_log for select to authenticated using (true);
create policy "purchases: leitura autenticada"
  on public.purchases for select to authenticated using (true);

-- Segunda tranca: a RLS já barra a escrita (não há policy de INSERT/UPDATE/
-- DELETE), mas tirar o privilégio fecha a porta também no caso de alguém
-- adicionar uma policy por engano mais adiante.
revoke insert, update, delete, truncate
  on public.visitors, public.events_log, public.purchases
  from anon, authenticated;


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
as $$
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
$$;

-- Janelas vencidas não servem para nada; a Fase 8 agenda esta limpeza.
create or replace function public.purge_rate_limits(p_older_than_hours integer default 24)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_apagadas integer;
begin
  delete from public.rate_limits
   where window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;

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
create policy "meta_insights_cache: leitura autenticada"
  on public.meta_insights_cache for select to authenticated using (true);

revoke all on public.rate_limits from anon, authenticated;
revoke insert, update, delete, truncate
  on public.meta_insights_cache from anon, authenticated;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.purge_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.purge_rate_limits(integer) to service_role;


-- ============================================================================
-- VERIFICAÇÃO FINAL · o relatório que diz se deu certo
-- ============================================================================
do $$
declare
  v_tabelas        integer;
  v_sem_rls        text[];
  v_policy_escrita integer;
  v_id             uuid;
  v_lido           text;
  v_bruto          bytea;
  v_ok             boolean := true;
begin
  raise notice '';
  raise notice '═══════════════════════════════════════════════════════';
  raise notice '  RRTrack · relatório de instalação';
  raise notice '═══════════════════════════════════════════════════════';

  select count(*) into v_tabelas from pg_tables where schemaname = 'public';
  if v_tabelas = 9 then
    raise notice '  [ok]    9 tabelas criadas';
  else
    raise notice '  [FALHA] esperava 9 tabelas, encontrei %', v_tabelas;
    v_ok := false;
  end if;

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

  if has_column_privilege('authenticated', 'public.meta_pixels', 'capi_token_enc', 'SELECT')
     or has_column_privilege('anon', 'public.settings', 'webhook_token_enc', 'SELECT') then
    raise notice '  [FALHA] coluna de segredo legível pelo painel';
    v_ok := false;
  else
    raise notice '  [ok]    Segredos fora do alcance do painel';
  end if;

  insert into public.meta_pixels (label, pixel_id)
  values ('__verificacao__', '999999999') returning id into v_id;

  perform public.set_meta_pixel_secret(v_id, 'token-de-verificacao-1234');
  select public.get_meta_pixel_secret(v_id) into v_lido;
  select capi_token_enc into v_bruto from public.meta_pixels where id = v_id;

  if v_lido = 'token-de-verificacao-1234'
     and position(convert_to('token-de-verificacao-1234', 'UTF8') in v_bruto) = 0 then
    raise notice '  [ok]    Cifra funcionando (e o bytea não tem texto em claro)';
  else
    raise notice '  [FALHA] a cifra não fechou o ciclo';
    v_ok := false;
  end if;

  delete from public.meta_pixels where id = v_id;

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
$$;
