-- Emula o essencial de um projeto Supabase para validar as migrations
-- localmente: os três roles, os schemas e um SUBSTITUTO do Vault.
-- NÃO faz parte das migrations — é só andaime de teste.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- O Supabase concede amplamente no public e conta com a RLS para barrar.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ############################################################################
-- SUBSTITUTO DO SUPABASE VAULT — SÓ PARA TESTE LOCAL
--
-- ⚠️  NÃO CIFRA NADA. Guarda o segredo em texto puro.
--
-- Existe só para que a lógica das migrations (criar segredo, atualizar, ler
-- pelo id) possa ser exercitada num Postgres comum. No Supabase de verdade,
-- o Vault cifra em disco com uma chave-mestra que vive FORA do banco.
--
-- Por isso a asserção de "o segredo não está em claro" é pulada quando este
-- substituto está em uso — ver 01_seguranca.sql.
-- ############################################################################
create schema if not exists vault;

create table if not exists vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text not null default '',
  secret      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Marca que estamos no substituto, e não no Vault real.
comment on schema vault is 'SUBSTITUTO DE TESTE — não cifra';

create or replace view vault.decrypted_secrets as
  select id, name, description,
         secret            as secret,
         secret            as decrypted_secret,
         created_at, updated_at
    from vault.secrets;

create or replace function vault.create_secret(
  new_secret      text,
  new_name        text default null,
  new_description text default ''
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into vault.secrets (secret, name, description)
  values (new_secret, new_name, coalesce(new_description, ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function vault.update_secret(
  secret_id       uuid,
  new_secret      text default null,
  new_name        text default null,
  new_description text default null
) returns void language plpgsql as $$
begin
  update vault.secrets
     set secret      = coalesce(new_secret, secret),
         name        = coalesce(new_name, name),
         description = coalesce(new_description, description),
         updated_at  = now()
   where id = secret_id;
end;
$$;
