-- =============================================================================
-- 0013 · Páginas — conversão por URL
-- =============================================================================
-- Qual página traz gente que compra, e qual traz gente que só passa.
--
-- **A URL perde a query string de propósito.** Sem isso, a mesma página vira
-- vinte linhas — uma por combinação de `utm_*`, `fbclid`, `gclid` — e a taxa
-- de conversão de cada uma é calculada sobre um punhado de visitas. A página
-- é a mesma; o que muda é de onde a pessoa veio, e isso já está em Campanhas.
--
-- **A atribuição é "o visitante VIU esta página".** Quem passou por três
-- páginas e comprou conta nas três. Não é dupla contagem por descuido: a
-- pergunta que a tela responde é "esta página participa de vendas?", não
-- "qual página levou o crédito?" — essa segunda exige modelo de atribuição,
-- que é outra conversa e não cabe numa tabela.
--
-- Por isso a soma das colunas NÃO fecha com o total do painel, e a tela diz
-- isso com todas as letras. Um número que não fecha sem aviso é pior que
-- número nenhum.
-- =============================================================================

create or replace function public.painel_paginas(
  de timestamptz,
  ate timestamptz
)
returns table (
  url          text,
  visitantes   bigint,
  checkouts    bigint,
  compras      bigint,
  receita      numeric
)
language sql
stable
set search_path = ''
as $$
  with vistas as (
    -- Uma linha por (página, pessoa): quem recarregou dez vezes é uma pessoa.
    select distinct
      split_part(e.event_source_url, '?', 1) as url,
      e.trck_user_id
    from public.events_log e
    where e.created_at >= de
      and e.created_at <  ate
      and e.event_source_url is not null
      and e.trck_user_id     is not null
  ),
  checkouts as (
    -- O checkout conta onde ELE aconteceu, não onde a visita começou: é o que
    -- diz qual página tem botão que funciona.
    select distinct
      split_part(e.event_source_url, '?', 1) as url,
      e.trck_user_id
    from public.events_log e
    where e.created_at >= de
      and e.created_at <  ate
      and e.event_source_url is not null
      and e.trck_user_id     is not null
      and lower(e.event_name) in
          ('initiatecheckout', 'begin_checkout', 'checkout', 'iniciarcheckout')
  ),
  compras as (
    select
      p.trck_user_id,
      count(*)                     as n,
      coalesce(sum(p.value), 0)    as total
    from public.purchases p
    where p.created_at >= de
      and p.created_at <  ate
      and p.status = 'aprovada'
      and p.trck_user_id is not null
    group by 1
  )
  select
    v.url,
    count(distinct v.trck_user_id),
    count(distinct c.trck_user_id),
    coalesce(sum(co.n), 0),
    coalesce(sum(co.total), 0)
  from vistas v
  left join checkouts c
    on c.url = v.url and c.trck_user_id = v.trck_user_id
  left join compras co
    on co.trck_user_id = v.trck_user_id
  group by v.url
  order by 2 desc;
$$;

comment on function public.painel_paginas(timestamptz, timestamptz) is
  'Visitantes únicos, checkouts, compras e receita por URL (sem query string). A atribuição é "o visitante viu esta página", então a soma das colunas não fecha com o total do painel.';

-- Função nova em `public` nasce com `execute` para PUBLIC, que inclui `anon`
-- — o role da chave que vai no bundle do navegador. Ver a asserção 8.
revoke all on function public.painel_paginas(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.painel_paginas(timestamptz, timestamptz)
  to authenticated;
