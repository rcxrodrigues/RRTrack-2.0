-- =============================================================================
-- 0006 · webhooks_recebidos — nada que chega se perde
-- =============================================================================
-- A rota de webhook só entendia Appmax e Pagou. Qualquer outro formato levava
-- 202 e era DESCARTADO: se a loja apontasse um checkout novo para cá, a venda
-- sumia e ninguém ficava sabendo.
--
-- Agora tudo que chega é gravado aqui ANTES de qualquer interpretação. Duas
-- consequências:
--
--   1. Nenhuma venda se perde enquanto o adaptador daquele checkout não
--      existe — dá para reprocessar depois, com o payload original.
--   2. O formato real fica VISÍVEL no painel. É assim que se escreve o
--      adaptador certo: contra o payload que chegou, não contra documentação.
--
-- É a resposta para "ainda não sei qual checkout vou usar": em vez de quatro
-- adaptadores adivinhados, um lugar onde o payload de verdade aparece.
-- =============================================================================

create table if not exists public.webhooks_recebidos (
  id           uuid primary key default gen_random_uuid(),

  -- Qual adaptador reconheceu. NULL = ninguém reconheceu, e é justamente
  -- esse o caso que interessa olhar.
  adaptador    text,

  -- O corpo exatamente como chegou. jsonb quando é JSON válido; quando não
  -- é, fica em `corpo_texto` — payload quebrado também é informação.
  corpo        jsonb,
  corpo_texto  text,

  -- Cabeçalhos, para descobrir como o gateway assina. O header da assinatura
  -- da MillionsPay e o X-Adoorei-hash aparecem aqui.
  headers      jsonb,

  ip           inet,
  -- Preenchido quando virou venda, para ligar as duas pontas.
  transaction_id text,

  created_at   timestamptz not null default now()
);

create index if not exists webhooks_recebidos_created_idx
  on public.webhooks_recebidos (created_at desc);

-- O índice que importa: achar rápido o que NINGUÉM reconheceu.
create index if not exists webhooks_recebidos_desconhecidos_idx
  on public.webhooks_recebidos (created_at desc) where adaptador is null;

-- -----------------------------------------------------------------------------
-- RLS — mesma regra de sempre: o painel lê, só o service_role escreve.
-- -----------------------------------------------------------------------------
alter table public.webhooks_recebidos enable row level security;

drop policy if exists "webhooks_recebidos: leitura autenticada" on public.webhooks_recebidos;
create policy "webhooks_recebidos: leitura autenticada"
  on public.webhooks_recebidos for select to authenticated using (true);

revoke insert, update, delete, truncate
  on public.webhooks_recebidos from anon, authenticated;
revoke all on public.webhooks_recebidos from anon;
