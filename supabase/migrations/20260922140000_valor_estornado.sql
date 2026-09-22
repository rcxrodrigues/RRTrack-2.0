-- =============================================================================
-- 0009 · reverted_value — o estorno parcial não pode comer a venda inteira
-- =============================================================================
-- `purchases.value` é o que o cliente PAGOU. O evento de estorno também traz
-- um valor — e aí está o problema: não se sabe, sem ler a documentação de
-- cada gateway, se aquele valor é o total original ou só o pedaço devolvido.
--
-- Nenhuma das cinco documentações diz. E as duas leituras erram de formas
-- opostas, as duas caladas:
--
--   · se o gateway manda o PEDAÇO e a gente grava em `value`, a venda de
--     R$ 200 com estorno de R$ 20 passa a valer R$ 20 no faturamento;
--   · se o gateway manda o TOTAL e a gente manda esse total ao GA4 como
--     refund de um estorno parcial, subtrai R$ 200 de uma devolução de R$ 20.
--
-- A saída não passa por descobrir qual é: são colunas separadas, e aí as
-- duas perguntas têm resposta independente. `value` é da venda e nenhum
-- evento de reversão mexe nele; `reverted_value` é o que o evento de
-- reversão trouxe, e é ele que vai ao GA4 — caindo para `value` quando o
-- gateway não informa nada, que é a única suposição disponível.
--
-- Funciona sem saber o que cada gateway faz, o que é o ponto.
-- =============================================================================

alter table public.purchases
  add column if not exists reverted_value numeric(14,2);

comment on column public.purchases.reverted_value is
  'Valor que o evento de reversão trouxe. NULL = o gateway não informou, e aí o refund usa o value da venda. Separado de `value` porque estorno parcial existe e nenhum gateway documenta a unidade: sem a separação, um lado dos dois sempre erra.';

grant select (reverted_value) on public.purchases to authenticated;
