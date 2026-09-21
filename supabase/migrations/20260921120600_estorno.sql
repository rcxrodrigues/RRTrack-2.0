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
