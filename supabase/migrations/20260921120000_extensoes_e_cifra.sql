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
