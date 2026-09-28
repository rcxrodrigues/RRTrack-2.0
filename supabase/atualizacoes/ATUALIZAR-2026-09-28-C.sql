-- ============================================================================
-- ATUALIZAR (C) — o que falta no banco que já está no ar
--
-- Cole INTEIRO no SQL Editor do Supabase e rode. É a migration que entrou
-- depois de 20260927160000_retencao_do_que_pede_acao (o ATUALIZAR-B).
--
-- Rodar duas vezes não faz mal: tudo aqui é idempotente, e isso é
-- verificado no CI (aplicar.sh aplica tudo duas vezes no mesmo banco).
--
-- O que isto liga: a ÁRVORE de geolocalização na Visão geral — País, depois
-- Estado, depois Cidade, com receita e visitantes em cada nível. Sem rodar,
-- a consulta falha e o cartão "De onde vem" aparece com o erro na tela.
--
-- E o que isto APAGA: `painel_geo` e `painel_cidades`, que a árvore
-- substitui. Não é arrumação — `painel_cidades` exige cidade não nula, então
-- quem tem país e não tem cidade sumia dela. Deixá-la de pé é deixar pronto
-- o caminho para repetir esse furo na próxima tela.
-- ============================================================================

-- =============================================================================
-- 0018 · Geo em árvore: País > Estado > Cidade num grão só
-- =============================================================================
-- `painel_geo` agrupa por país+região e `painel_cidades` por país+região+cidade.
-- Duas consultas, dois grãos — e para desenhar uma ÁRVORE isso não serve:
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ OS TOTAIS NÃO FECHARIAM ENTRE OS NÍVEIS, E O ERRO SERIA MUDO.           │
-- │                                                                          │
-- │ `painel_cidades` exige `geo_city is not null`. Quem tem país e não tem   │
-- │ cidade — e isso acontece: a Vercel manda país sempre, cidade nem sempre  │
-- │ — sai da conta da cidade e fica na da região. Somando as cidades de um   │
-- │ estado para conferir com o estado, falta gente, e nada na tela diria por │
-- │ quê. Numa árvore, em que abrir o nó é justamente conferir a soma, isso   │
-- │ é o pior tipo de defeito.                                                │
-- │                                                                          │
-- │ Uma função só, no grão mais FINO, com a cidade nula preservada. Quem     │
-- │ soma os níveis de cima é o TypeScript, a partir das mesmas linhas — e    │
-- │ aí fecha por construção, não por coincidência.                           │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- `painel_geo` e `painel_cidades` SAEM junto, e não por arrumação: deixar
-- `painel_cidades` de pé é deixar a armadilha de pé. Ela é o caminho pronto e
-- óbvio para quem for escrever a próxima tela de cidades, e traz o furo da
-- cidade nula embutido — o mesmo defeito voltaria numa tela nova, do mesmo
-- jeito calado. Nada as chama depois desta migration.
-- =============================================================================

create or replace function public.painel_geo_arvore(de timestamptz, ate timestamptz)
returns table (
  pais        text,
  regiao      text,
  cidade      text,
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
      geo_country as pais,
      geo_region  as regiao,
      geo_city    as cidade,
      count(*)    as total
    from public.visitors
    where created_at >= de and created_at < ate and geo_country is not null
    group by 1, 2, 3
  ),
  c as (
    select
      geo_country              as pais,
      geo_region               as regiao,
      geo_city                 as cidade,
      count(*)                 as pedidos,
      coalesce(sum(value), 0)  as receita
    from public.purchases
    where created_at >= de and created_at < ate
      and geo_country is not null and status = 'aprovada'
    group by 1, 2, 3
  )
  select
    coalesce(v.pais, c.pais),
    coalesce(v.regiao, c.regiao),
    coalesce(v.cidade, c.cidade),
    coalesce(v.total, 0),
    coalesce(c.pedidos, 0),
    coalesce(c.receita, 0)
  from v
  full outer join c
    on  c.pais   =              v.pais
    and c.regiao is not distinct from v.regiao
    and c.cidade is not distinct from v.cidade
  -- `is not distinct from` e não `=`: com `=`, NULL nunca casa com NULL e a
  -- venda de quem não tem cidade viraria uma linha separada da visita dele.
  order by 6 desc, 4 desc;
$$;

comment on function public.painel_geo_arvore(timestamptz, timestamptz) is
  'Geo no grão mais fino, com região e cidade nulas preservadas. Os níveis de cima somam a partir daqui, então fecham por construção.';

-- Função nova em `public` nasce com `execute` para PUBLIC — que inclui `anon`,
-- o role da chave que vai no bundle do navegador.
revoke all on function public.painel_geo_arvore(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.painel_geo_arvore(timestamptz, timestamptz)
  to authenticated;

-- O índice que a varredura usa: o recorte é sempre por janela de tempo.
create index if not exists visitors_geo_arvore_idx
  on public.visitors (created_at, geo_country, geo_region, geo_city);

-- -----------------------------------------------------------------------------
-- As duas que a árvore substitui
-- -----------------------------------------------------------------------------
-- `if exists` porque a migration roda duas vezes: na segunda elas já não estão.
drop function if exists public.painel_cidades(timestamptz, timestamptz, integer);
drop function if exists public.painel_cidades(timestamptz, timestamptz);
drop function if exists public.painel_geo(timestamptz, timestamptz);

-- E o índice que só a consulta de cidades usava.
drop index if exists public.visitors_geo_city_idx;
