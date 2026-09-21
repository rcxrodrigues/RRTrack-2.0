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
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise exception using
      errcode = 'undefined_schema',
      message = 'O schema "vault" não existe neste projeto',
      hint    = 'Ative a extensão "supabase_vault" em Database → Extensions e rode de novo.';
  end if;
end;
$$;

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
as $$
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
$$;

-- -----------------------------------------------------------------------------
-- Ler um segredo. Só o servidor chega aqui, via as funções public.get_*.
-- -----------------------------------------------------------------------------
create or replace function private.ler_segredo(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

-- Apagar o segredo junto com a conta, para não acumular lixo no cofre.
create or replace function private.esquecer_segredo(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_id is not null then
    delete from vault.secrets where id = p_id;
  end if;
end;
$$;

-- Os últimos 4 caracteres, para o painel mostrar ••••••••4f2a sem abrir o cofre.
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
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
