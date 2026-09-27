-- ============================================================================
-- ATUALIZAR — o que falta no banco que já está no ar
--
-- Cole INTEIRO no SQL Editor do Supabase e rode. São as duas migrations
-- que entraram depois de 20260925200000_receita_por_utm_completa.
--
-- Rodar duas vezes não faz mal: tudo aqui é idempotente, e isso é
-- verificado no CI (aplicar.sh aplica tudo duas vezes no mesmo banco).
--
-- O que isto liga: a lista de CIDADES na Visão geral. Sem ela o cartão
-- aparece vazio — e lê como "sem dado", não como "não instalado".
-- ============================================================================

-- -----------------------------------------------------------------------------
-- painel_cidades — o geo um nível abaixo da região
-- -----------------------------------------------------------------------------
-- `painel_geo` agrupa por país e região. A região responde "de onde vem o
-- dinheiro" no atacado; a CIDADE é o que decide frete, prazo de entrega e
-- onde a fraude se concentra — e numa loja de drop no Brasil, "SP" é metade
-- do país, então parar na região é parar cedo demais.
--
-- Função NOVA em vez de acrescentar a coluna em `painel_geo`: mudar o tipo
-- de retorno de uma função existente exige `drop function` antes do
-- `create or replace`, e aí a migration deixaria de rodar duas vezes sem
-- erro — que é a regra que faz a instalação funcionar num banco que já
-- existe. A lista de regiões continua exatamente como estava.
--
-- O `full outer join` é o mesmo de `painel_geo`, e pela mesma razão: cidade
-- que vendeu e cuja visita caiu fora da janela ainda tem de aparecer com a
-- receita dela, senão o total das cidades não fecha com o faturamento.
-- -----------------------------------------------------------------------------

create or replace function public.painel_cidades(de timestamptz, ate timestamptz)
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
  order by 4 desc, 6 desc;
$$;

-- Índice para o agrupamento por cidade não varrer a tabela inteira. Composto
-- com `created_at` porque a consulta SEMPRE filtra por janela antes de
-- agrupar — um índice só em `geo_city` não ajudaria nisso.
create index if not exists visitors_geo_city_idx
  on public.visitors (created_at, geo_city);

-- Função nova em `public` nasce com `execute` para PUBLIC — que inclui
-- `anon`, o role da chave que vai no bundle do navegador. Revoga e devolve
-- só a quem entrou.
revoke all on function public.painel_cidades(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.painel_cidades(timestamptz, timestamptz)
  to authenticated;

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
