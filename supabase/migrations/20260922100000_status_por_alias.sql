-- =============================================================================
-- 0008 · Aliases de status configuráveis, e o motivo de um webhook não virar venda
-- =============================================================================
-- Duas mudanças, e as duas nasceram da mesma descoberta.
--
-- O suporte da Yampi confirmou (22/09/2026) que os aliases de status
-- **são configuráveis por loja**: não existe lista fixa, e a única forma de
-- saber os da sua loja é chamar `GET /{alias}/checkout/statuses`. Uma loja
-- pode renomear o estorno para `devolvido`, ou criar `em_separacao`.
--
-- Isso invalida um mapa fixo no código. É a mesma regra que já vale para a
-- Appmax: decidir por um campo cuja enumeração ninguém conhece é escolher
-- ser surpreendido. Lá a saída foi decidir pelo EVENTO; aqui o evento não
-- basta, porque `order.status.updated` só diz "mudou" — o alias é que diz
-- para quê. Então o mapa vira CONFIGURAÇÃO, como os domínios do checkout.
--
-- O estrago que isso evita é específico: um alias de estorno que não bate
-- com o nosso chute faria o refund NUNCA chegar ao GA4, e o faturamento
-- ficaria inflado por uma venda que voltou para o cliente.
--
-- A segunda mudança é a rede de segurança. Até agora, "reconheci e ignorei
-- de propósito" (nota fiscal) e "reconheci e não soube o que fazer" (alias
-- desconhecido) ficavam IGUAIS no painel: badge verde com o nome do
-- adaptador. O primeiro é normal; o segundo é uma venda possivelmente
-- perdida. Agora o motivo fica gravado, e a tela pode distinguir.
-- =============================================================================

alter table public.settings
  add column if not exists status_aliases text[] not null default '{}';

comment on column public.settings.status_aliases is
  'Mapa alias -> status, um por linha, no formato "alias = status". Os aliases de status da Yampi são configuráveis por loja (GET /{alias}/checkout/statuses), então não podem morar no código. Ex.: {"devolvido = estornada", "em_separacao = pendente"}';

-- Coluna nova NÃO é visível por herança: o SELECT desta tabela foi revogado
-- e devolvido coluna a coluna (ver 0002). Sem o grant, a tela de
-- configuração quebra com "permission denied".
grant select (status_aliases) on public.settings to authenticated;

alter table public.webhooks_recebidos
  add column if not exists motivo text;

comment on column public.webhooks_recebidos.motivo is
  'Por que o payload não virou venda. NULL quando virou, ou quando nenhum adaptador reconheceu. Distingue "ignorado de propósito" de "não soube ler" — o segundo é venda possivelmente perdida e precisa aparecer no painel.';
