-- =============================================================================
-- 0020 · o cache aceita a série DIÁRIA de gasto
-- =============================================================================
-- A visão geral ganha um quadro com receita e investimento no MESMO eixo, por
-- dia. A receita já sai de `painel_serie_diaria`; o gasto não existia nesse
-- grão — pedimos à Meta um `time_range` agregado, sem `time_increment`.
--
-- Por que uma linha no cache e não uma tabela nova
-- ------------------------------------------------
-- `meta_insights_cache` já é exatamente a forma certa: chave
-- (conta, nível, início, fim) e um `data` jsonb. A série diária é só mais um
-- "nível" — e precisa ser um nível PRÓPRIO, não reaproveitar `campaign`:
--
--   A árvore de campanhas e a série diária cobrem o MESMO período e a MESMA
--   conta. Gravadas sob a mesma chave, uma sobrescreveria a outra a cada
--   troca de tela — a árvore mostraria dias e o gráfico mostraria campanhas,
--   alternando conforme quem chegou por último. Não quebraria nada: só
--   mostraria o dado errado, calado.
--
-- O check existia justamente para barrar valor inventado, então ele cresce em
-- vez de sair. `diario` é nosso, não da Meta — lá a chamada vai com
-- `level=account` e `time_increment=1`.
--
-- O teto de 25% da pontuação BUC e a fila serial por conta continuam valendo:
-- a busca nova passa pelo mesmo `emFila`, como todas as outras.
-- =============================================================================

alter table public.meta_insights_cache
  drop constraint if exists meta_insights_level_valido;

alter table public.meta_insights_cache
  add constraint meta_insights_level_valido
  check (level in ('campaign', 'adset', 'ad', 'diario'));

comment on column public.meta_insights_cache.level is
  'O grão do que está guardado. `campaign`/`adset`/`ad` são níveis da Meta e montam a árvore; `diario` é NOSSO — a série de gasto por dia, pedida com time_increment=1. Precisa ser distinto porque a árvore e a série cobrem a mesma conta e o mesmo período: sob a mesma chave, uma sobrescreveria a outra a cada troca de tela.';
