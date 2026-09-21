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
RODAPE
} > "$OUT"

echo "gerado: supabase/INSTALAR.sql ($(wc -l < "$OUT") linhas)"
