#!/usr/bin/env bash
# Regera supabase/INSTALAR.sql a partir das migrations.
# Rode sempre que mexer numa migration.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$RAIZ/supabase/INSTALAR.sql"

{
  cat <<'CABECALHO'
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
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise exception using
      errcode = 'undefined_schema',
      message = 'O Supabase Vault não está ativo neste projeto',
      hint    = 'Vá em Database → Extensions, ative "supabase_vault" e rode este arquivo de novo.';
  end if;
  raise notice 'Cofre (Supabase Vault) disponível.';
end;
$$;

CABECALHO

  for f in "$RAIZ"/supabase/migrations/*.sql; do
    n="$(basename "$f" .sql)"
    printf '\n-- ============================================================================\n'
    printf -- '-- MIGRATION · %s\n' "$n"
    printf -- '-- ============================================================================\n'
    cat "$f"
    printf '\n'
  done

  cat <<'RODAPE'

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
  v_ponteiro       uuid;
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
$$;
RODAPE
} > "$OUT"

echo "gerado: supabase/INSTALAR.sql ($(wc -l < "$OUT") linhas)"
