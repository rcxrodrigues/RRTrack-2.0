-- ============================================================================
-- ATUALIZAR (F) — o que falta no banco que já está no ar
--
-- Cole INTEIRO no SQL Editor do Supabase e rode. É a migration que entrou
-- depois de 20260930100000_clique_do_google (o ATUALIZAR-E).
--
-- Rodar duas vezes não faz mal: tudo aqui é idempotente, e isso é
-- verificado no CI (aplicar.sh aplica tudo duas vezes no mesmo banco).
--
-- O que isto liga: o quadro de RECEITA E INVESTIMENTO POR DIA na visão
-- geral. A receita já saía de `painel_serie_diaria`; o gasto não existia
-- nesse grão, e passa a ser buscado da Meta com `time_increment=1` e
-- guardado no cache que já existe.
--
-- É UMA LINHA DE CHECK, e nada mais: nenhuma tabela nova, nenhuma coluna
-- nova, nenhum dado tocado. O `check` da coluna `level` aceitava só os três
-- níveis da Meta (`campaign`, `adset`, `ad`) e passa a aceitar também o
-- nosso `diario`.
--
-- SEM RODAR, a tela não quebra — mas o quadro fica sem a linha do
-- investido: a gravação no cache é recusada pelo check, a leitura seguinte
-- não acha nada, e a cada abertura da visão geral o painel refaz a consulta
-- mais cara que ele tem contra a API da Meta. Ou seja: sem o benefício e
-- pagando a cota. Vale rodar.
-- ============================================================================

-- =============================================================================
-- 0020 · o cache aceita a série DIÁRIA de gasto
-- =============================================================================
-- Por que um nível PRÓPRIO e não reaproveitar `campaign`:
--
--   A árvore de campanhas e a série diária cobrem o MESMO período e a MESMA
--   conta. Gravadas sob a mesma chave, uma sobrescreveria a outra a cada
--   troca de tela — a árvore mostraria dias e o gráfico mostraria campanhas,
--   alternando conforme quem chegou por último. Não quebraria nada: só
--   mostraria o dado errado, calado.
--
-- O check existia justamente para barrar valor inventado, então ele cresce
-- em vez de sair. `diario` é nosso, não da Meta — lá a chamada vai com
-- `level=account` e `time_increment=1`.
-- =============================================================================

alter table public.meta_insights_cache
  drop constraint if exists meta_insights_level_valido;

alter table public.meta_insights_cache
  add constraint meta_insights_level_valido
  check (level in ('campaign', 'adset', 'ad', 'diario'));

comment on column public.meta_insights_cache.level is
  'O grão do que está guardado. `campaign`/`adset`/`ad` são níveis da Meta e montam a árvore; `diario` é NOSSO — a série de gasto por dia, pedida com time_increment=1. Precisa ser distinto porque a árvore e a série cobrem a mesma conta e o mesmo período: sob a mesma chave, uma sobrescreveria a outra a cada troca de tela.';

-- ============================================================================
-- Conferência — diz na tela se ficou de pé
-- ============================================================================
do $conf$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'meta_insights_cache'
     and c.conname = 'meta_insights_level_valido';

  if v_def is null then
    raise notice '  [FALHA] o check sumiu — me mande este relatório.';
  elsif v_def like '%diario%' then
    raise notice '  [ok] o cache aceita a série diária de gasto.';
    raise notice '       Abra a visão geral: o quadro de receita e investimento';
    raise notice '       por dia já deve estar desenhando as duas linhas.';
  else
    raise notice '  [FALHA] o check ficou sem `diario`: %', v_def;
  end if;
end;
$conf$;
