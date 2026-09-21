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
