-- -----------------------------------------------------------------------------
-- painel_cidades ganha teto
-- -----------------------------------------------------------------------------
-- A versão anterior devolvia UMA LINHA POR CIDADE DISTINTA no período, sem
-- limite. `painel_geo` pode fazer isso porque região tem cardinalidade
-- conhecida — 27 no Brasil. Cidade não tem teto: uma loja com cem mil
-- visitantes no mês espalha por milhares delas.
--
-- E a visão geral é `force-dynamic`: isso acontecia a CADA abertura da tela,
-- na mesma leva das outras cinco consultas, para a tela mostrar cinco linhas.
-- Tudo o que passava da quinta era transferido do Postgres, parseado em
-- TypeScript e descartado na renderização.
--
-- O `order by` já garante que as linhas mantidas são as de cima, então
-- truncar no SQL não muda o que a tela mostra. O parâmetro tem padrão para
-- a chamada existente não precisar mudar, e existe para o painel poder pedir
-- mais quando a lista virar uma tela própria.
--
-- Migration nova em vez de editar a de ontem: a regra do projeto é corrigir
-- com migration nova, e a assinatura muda (parâmetro a mais), então o
-- `create or replace` sozinho não bastaria — o `drop` explícito vem antes.
-- -----------------------------------------------------------------------------

drop function if exists public.painel_cidades(timestamptz, timestamptz);

create or replace function public.painel_cidades(
  de      timestamptz,
  ate     timestamptz,
  quantos integer default 20
)
returns table (
  cidade      text,
  regiao      text,
  pais        text,
  visitantes  bigint,
  aprovadas   bigint,
  receita     numeric
)
language sql
stable
set search_path = ''
as $$
  with v as (
    select
      geo_city     as cidade,
      geo_region   as regiao,
      geo_country  as pais,
      count(*)     as total
    from public.visitors
    where created_at >= de and created_at < ate and geo_city is not null
    group by 1, 2, 3
  ),
  c as (
    select
      geo_city                 as cidade,
      geo_region               as regiao,
      geo_country              as pais,
      count(*)                 as pedidos,
      coalesce(sum(value), 0)  as receita
    from public.purchases
    where created_at >= de and created_at < ate
      and geo_city is not null and status = 'aprovada'
    group by 1, 2, 3
  )
  select
    coalesce(v.cidade, c.cidade),
    coalesce(v.regiao, c.regiao),
    coalesce(v.pais, c.pais),
    coalesce(v.total, 0),
    coalesce(c.pedidos, 0),
    coalesce(c.receita, 0)
  from v
  full outer join c
    on  c.cidade = v.cidade
    and c.regiao is not distinct from v.regiao
    and c.pais   is not distinct from v.pais
  order by 4 desc, 6 desc
  limit greatest(quantos, 1);
$$;

revoke all on function public.painel_cidades(timestamptz, timestamptz, integer)
  from public, anon;
grant execute on function public.painel_cidades(timestamptz, timestamptz, integer)
  to authenticated;
