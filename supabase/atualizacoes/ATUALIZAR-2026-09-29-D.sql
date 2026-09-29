-- ============================================================================
-- ATUALIZAR (D) — o que falta no banco que já está no ar
--
-- Cole INTEIRO no SQL Editor do Supabase e rode. É a migration que entrou
-- depois de 20260928120000_geo_em_arvore (o ATUALIZAR-C).
--
-- Rodar duas vezes não faz mal: tudo aqui é idempotente, e isso é
-- verificado no CI (aplicar.sh aplica tudo duas vezes no mesmo banco).
--
-- O que isto liga: DUAS COLUNAS que o código já produzia e jogava fora.
--
--   · `zip` — o CEP do comprador. Vira o `zp` da Meta, que é parâmetro de
--     match e num checkout brasileiro é obrigatório, portanto o mais fácil
--     de ganhar. A função que o normaliza existe desde a Fase 4, com teste,
--     e nunca tinha sido chamada porque não havia onde guardar o valor.
--
--   · `occurred_at` — quando a venda aconteceu SEGUNDO O GATEWAY. Os cinco
--     adaptadores já extraíam essa hora e ela morria no caminho. É a fonte
--     do `event_time` da Meta e do `timestamp_micros` do GA4; sem ela os
--     dois usam a hora em que o webhook chegou aqui, e uma venda recuperada
--     pelo Reprocessar entra datada de HOJE.
--
-- Sem rodar, nada quebra na tela: o envio continua como hoje, com os dois
-- campos ausentes. O que não acontece é a melhora.
-- ============================================================================

-- =============================================================================
-- 0018 · zip e occurred_at — dois campos que o código já produzia e jogava fora
-- =============================================================================
-- A auditoria da lógica de tracking achou duas funções órfãs do mesmo tipo:
-- implementadas, testadas, e nunca chamadas porque não havia onde guardar o
-- que elas produziam.
--
-- `zip` — o CEP
-- -------------
-- `hashCep()` existe em `src/lib/hash.ts` desde a Fase 4, com o teste dos
-- vetores da Meta, e nunca foi chamada: não havia `zp` no `UserDataCapi`,
-- nenhum adaptador extraía o CEP e nenhuma coluna o guardava.
--
-- O `zp` é um dos parâmetros de match que a Meta aceita — está no
-- `user_data.py` do SDK oficial, com normalização própria (tira espaço,
-- corta no primeiro hífen: `01310-100` → `01310`). Num checkout brasileiro o
-- CEP é obrigatório, então é o parâmetro mais fácil de ganhar.
--
-- `occurred_at` — quando a venda aconteceu
-- ----------------------------------------
-- Os CINCO adaptadores já extraem `ocorridoEm` (`paid_at`, `created_at` ou
-- `time`, conforme o gateway) e o valor morria no caminho: `gravarCompra`
-- não tinha coluna para ele.
--
-- Isso importa para o `event_time` que vai à Meta e para o
-- `timestamp_micros` do GA4. Hoje eles saem de `purchases.created_at`, que é
-- quando o webhook chegou AQUI — não quando o pagamento ocorreu LÁ. No fluxo
-- normal a diferença é de segundos; num retry da Appmax (até quatro) ou num
-- Reprocessar de venda antiga, são dias. A hora do gateway é a verdadeira, e
-- `created_at` continua sendo a reserva para quando ele não informar.
--
-- Nenhuma das duas colunas muda dado existente: linha antiga fica com NULL e
-- cai na reserva, exatamente como antes.
-- =============================================================================

alter table public.purchases
  add column if not exists zip text;

alter table public.purchases
  add column if not exists occurred_at timestamptz;

comment on column public.purchases.zip is
  'CEP/postcode do comprador, como o gateway mandou. Vira o `zp` da Meta, hasheado no envio por hashCep() — que corta no primeiro hífen e PRESERVA letras, porque postcode britânico é letra e número. NULL = o gateway não mandou.';

comment on column public.purchases.occurred_at is
  'Quando a venda ocorreu SEGUNDO O GATEWAY (paid_at/created_at/time, conforme a plataforma). É a fonte do event_time da Meta e do timestamp_micros do GA4. NULL = o gateway não informou, e aí vale created_at — que é quando o webhook chegou aqui, não quando o pagamento aconteceu lá.';

-- Coluna nova nasce INVISÍVEL para o painel: o Supabase concede SELECT na
-- tabela, mas as colunas secretas obrigaram um `revoke all` + `grant select
-- (colunas)`, e a partir daí cada coluna nova precisa do seu. Sem isto a tela
-- quebra com "permission denied" — a asserção 3d guarda este lado.
grant select (zip, occurred_at) on public.purchases to authenticated;
