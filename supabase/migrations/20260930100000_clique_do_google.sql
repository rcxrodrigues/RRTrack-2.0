-- =============================================================================
-- 0019 · gclid e wbraid — o clique do Google, que só existe na hora
-- =============================================================================
-- O `fbclid` já era capturado desde a Fase 3 (e virava `fbc`). O lado do
-- Google não tinha nada: `gclid` aparecia num comentário de migration e numa
-- fixture de teste, e em lugar nenhum do código.
--
-- Por que capturar antes de existir integração com o Google Ads
-- -------------------------------------------------------------
-- O clique não dá para reconstruir. O `gclid` chega UMA vez, na URL da
-- primeira visita, e se ninguém o guardar ele não volta: nem a Shopify, nem o
-- checkout, nem o gateway o conhecem. No dia em que a importação de conversão
-- offline entrar, ela precisa do id do clique + hora + valor — e os três já
-- estarão aqui em vez de começarem daquele dia.
--
-- Por que DOIS, e por que não três
-- --------------------------------
-- O `ClickConversion` do Google Ads (SDK oficial v33, proto do
-- `conversion_upload_service`) aceita três identificadores, e o proto diz o
-- que cada um é:
--
--   · `gclid`  — "The Google click ID associated with this conversion"
--   · `wbraid` — "clicks associated with WEB conversions"
--   · `gbraid` — "clicks associated with APP conversions"
--
-- Os dois primeiros entram; o `gbraid` fica de fora porque só aparece em
-- campanha de APP, e o funil aqui é uma loja Shopify sem aplicativo nenhum.
-- Coluna que nunca recebe valor é pior que coluna ausente: ela sugere que
-- alguém já pensou no caso.
--
-- O `wbraid` importa porque é ele que chega quando o consentimento limita o
-- `gclid`. Guardar só o `gclid` perderia exatamente o clique que a privacidade
-- restringiu — e perderia CALADO, que é o defeito que este projeto mais evita.
--
-- Por que também em `purchases`
-- -----------------------------
-- Mesma razão de `fbp`/`fbc`/`ga_client_id` serem copiados no casamento: a
-- linha da venda tem de CONGELAR o clique que valia na hora da compra. A
-- pessoa pode voltar por outro anúncio depois, e o `visitors` guarda um
-- valor só — o da última visita. Sem a cópia, uma segunda visita reescreveria
-- o clique que gerou a venda anterior.
-- =============================================================================

alter table public.visitors  add column if not exists gclid  text;
alter table public.visitors  add column if not exists wbraid text;

alter table public.purchases add column if not exists gclid  text;
alter table public.purchases add column if not exists wbraid text;

comment on column public.visitors.gclid is
  'O Google click ID, cru, como veio na URL da visita. Não dá para reconstruir depois: chega uma vez e nem o checkout nem o gateway o conhecem. NULL = a visita não veio de clique do Google Ads.';

comment on column public.visitors.wbraid is
  'O identificador de clique WEB do Google quando o consentimento limita o gclid — o proto do ClickConversion chama assim. Guardar só o gclid perderia justamente o clique restringido pela privacidade. O gbraid (campanha de APP) não é capturado: a loja não tem aplicativo.';

comment on column public.purchases.gclid is
  'O gclid que valia na HORA DA COMPRA, copiado do visitante no casamento. Congelado aqui porque visitors guarda só o da última visita, e uma volta por outro anúncio reescreveria o clique que gerou esta venda.';

comment on column public.purchases.wbraid is
  'O wbraid que valia na hora da compra. Mesma razão do gclid ao lado.';

-- Coluna nova nasce INVISÍVEL para o painel: o Supabase concede SELECT na
-- tabela, mas as colunas secretas obrigaram um `revoke all` + `grant select
-- (colunas)`, e a partir daí cada coluna nova precisa do seu. Sem isto a tela
-- quebra com "permission denied" — a asserção 3d guarda este lado.
grant select (gclid, wbraid) on public.visitors  to authenticated;
grant select (gclid, wbraid) on public.purchases to authenticated;
