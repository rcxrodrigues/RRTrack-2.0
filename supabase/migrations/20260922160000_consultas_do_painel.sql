-- =============================================================================
-- 0010 · As consultas agregadas do painel
-- =============================================================================
-- O PostgREST não faz `group by` nem `sum`. Sem isto o painel baixaria as
-- linhas e somaria em JavaScript — funciona com cem linhas e derruba a tela
-- com cem mil. Agregação é trabalho de banco.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ São FUNÇÕES, não views, e o motivo é o FUSO.                              │
-- │                                                                           │
-- │ Uma view com bucket diário tem de escolher um fuso na hora de ser criada, │
-- │ e a única escolha disponível ali é UTC. A Vercel roda em UTC; quem olha o │
-- │ painel está em São Paulo, UTC-3. "Receita de hoje" mostraria só o que     │
-- │ entrou depois das 21h de ontem, e o dia de vendas apareceria rachado em   │
-- │ duas linhas.                                                              │
-- │                                                                           │
-- │ Pior: o número não bateria com o painel do gateway, que conta em fuso     │
-- │ local — e ninguém saberia por quê. É o ROAS fantasma em miniatura, que é  │
-- │ exatamente o que este sistema existe para não fazer.                      │
-- │                                                                           │
-- │ Com função, o fuso e o intervalo são PARÂMETROS: quem sabe o fuso é o     │
-- │ app, e o banco só soma entre dois instantes.                              │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Nenhuma é `security definer`. São `stable` e rodam com os privilégios de
-- QUEM CHAMA, então a RLS de `authenticated` vale igual — uma função
-- `definer` aqui devolveria agregado de dados que a política nega, sem erro
-- e sem aviso. A asserção 8 do teste de segurança guarda isso.
-- =============================================================================

-- O fuso do painel é configuração: a primeira oferta é brasileira, mas a
-- próxima pode não ser, e o número certo depende disso.
alter table public.settings
  add column if not exists timezone text not null default 'America/Sao_Paulo';

comment on column public.settings.timezone is
  'Fuso em que o painel agrupa os dias. UTC racharia o dia de vendas em duas linhas e o total não bateria com o painel do gateway.';

grant select (timezone) on public.settings to authenticated;

-- -----------------------------------------------------------------------------
-- O resumo do período — uma linha com tudo que vira cartão de métrica
-- -----------------------------------------------------------------------------
-- `ate` é EXCLUSIVO (`< ate`), não inclusivo: com `<=` o último milissegundo
-- do dia entraria em dois períodos ao mesmo tempo, e "hoje" + "ontem" somados
-- dariam mais que os dois dias juntos.
create or replace function public.painel_resumo(de timestamptz, ate timestamptz)
returns table (
  visitantes      bigint,
  identificados   bigint,
  eventos         bigint,
  aprovadas       bigint,
  receita         numeric,
  pendentes       bigint,
  recusadas       bigint,
  estornadas      bigint,
  devolvido       numeric,
  atribuidas      bigint,
  sem_atribuicao  bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (select count(*) from public.visitors v
      where v.created_at >= de and v.created_at < ate),
    (select count(*) from public.visitors v
      where v.created_at >= de and v.created_at < ate
        and v.email_hash is not null),
    (select count(*) from public.events_log e
      where e.created_at >= de and e.created_at < ate),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada'),
    -- A receita que VALE é só a aprovada. Somar pendente contaria boleto que
    -- ninguém pagou; somar estornada contaria dinheiro que voltou.
    (select coalesce(sum(p.value), 0) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada'),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'pendente'),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'recusada'),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status in ('estornada', 'chargeback')),
    -- O que voltou. `reverted_value` quando o gateway informou o pedaço;
    -- senão o valor da venda, que é o estorno total.
    (select coalesce(sum(coalesce(p.reverted_value, p.value)), 0)
       from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status in ('estornada', 'chargeback')),
    -- Quantas vendas casaram com um visitante. É a saúde da atribuição: se
    -- isto cai, o ROAS por campanha está ficando cego.
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada' and p.trck_user_id is not null),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada' and p.trck_user_id is null);
$$;

comment on function public.painel_resumo(timestamptz, timestamptz) is
  'Os totais do período. `ate` é exclusivo. Receita só de status aprovada — pendente é boleto que ninguém pagou, estornada é dinheiro que voltou.';

-- -----------------------------------------------------------------------------
-- Eventos por tipo — a quebra, e a etapa do meio do funil
-- -----------------------------------------------------------------------------
create or replace function public.painel_eventos_por_tipo(de timestamptz, ate timestamptz)
returns table (
  event_name  text,
  total       bigint,
  visitantes  bigint
)
language sql
stable
set search_path = ''
as $$
  select
    e.event_name,
    count(*),
    -- Distinto DENTRO do período. É o que o funil precisa: a pessoa que
    -- abriu o checkout três vezes é uma pessoa, não três.
    count(distinct e.trck_user_id)
  from public.events_log e
  where e.created_at >= de and e.created_at < ate
  group by e.event_name
  order by 2 desc;
$$;

-- -----------------------------------------------------------------------------
-- A série diária — o gráfico
-- -----------------------------------------------------------------------------
-- O `fuso` entra como parâmetro porque é o app que sabe dele. `generate_series`
-- devolve os dias VAZIOS também: sem isso o gráfico pularia o dia sem venda e
-- a linha mentiria sobre a forma da curva.
create or replace function public.painel_serie_diaria(
  de timestamptz,
  ate timestamptz,
  fuso text default 'America/Sao_Paulo'
)
returns table (
  dia         date,
  visitantes  bigint,
  eventos     bigint,
  aprovadas   bigint,
  receita     numeric
)
language sql
stable
set search_path = ''
as $$
  with dias as (
    select d::date as dia
    from generate_series(
      (de  at time zone fuso)::date,
      (ate at time zone fuso)::date - 1,
      interval '1 day'
    ) as d
  )
  select
    dias.dia,
    coalesce(v.total, 0),
    coalesce(e.total, 0),
    coalesce(c.pedidos, 0),
    coalesce(c.receita, 0)
  from dias
  left join (
    select (created_at at time zone fuso)::date as dia, count(*) as total
    from public.visitors
    where created_at >= de and created_at < ate
    group by 1
  ) v on v.dia = dias.dia
  left join (
    select (created_at at time zone fuso)::date as dia, count(*) as total
    from public.events_log
    where created_at >= de and created_at < ate
    group by 1
  ) e on e.dia = dias.dia
  left join (
    select
      (created_at at time zone fuso)::date as dia,
      count(*)                             as pedidos,
      coalesce(sum(value), 0)              as receita
    from public.purchases
    where created_at >= de and created_at < ate and status = 'aprovada'
    group by 1
  ) c on c.dia = dias.dia
  order by dias.dia;
$$;

comment on function public.painel_serie_diaria(timestamptz, timestamptz, text) is
  'Série por dia no fuso pedido, com os dias vazios inclusos — sem eles o gráfico pularia o dia sem venda e a curva mentiria.';

-- -----------------------------------------------------------------------------
-- Geo — visitante e venda na mesma linha, por região
-- -----------------------------------------------------------------------------
-- `full outer join` de propósito: o mapa precisa distinguir "visitou e não
-- comprou" de "comprou" — e venda sem visitante casado existe (é a venda
-- órfã), então os dois lados podem ter linha que o outro não tem.
create or replace function public.painel_geo(de timestamptz, ate timestamptz)
returns table (
  pais        text,
  regiao      text,
  visitantes  bigint,
  aprovadas   bigint,
  receita     numeric
)
language sql
stable
set search_path = ''
as $$
  with v as (
    select geo_country as pais, geo_region as regiao, count(*) as total
    from public.visitors
    where created_at >= de and created_at < ate and geo_country is not null
    group by 1, 2
  ),
  c as (
    select
      geo_country              as pais,
      geo_region               as regiao,
      count(*)                 as pedidos,
      coalesce(sum(value), 0)  as receita
    from public.purchases
    where created_at >= de and created_at < ate
      and geo_country is not null and status = 'aprovada'
    group by 1, 2
  )
  select
    coalesce(v.pais, c.pais),
    coalesce(v.regiao, c.regiao),
    coalesce(v.total, 0),
    coalesce(c.pedidos, 0),
    coalesce(c.receita, 0)
  from v
  full outer join c on c.pais = v.pais and c.regiao is not distinct from v.regiao
  order by 5 desc, 3 desc;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------
-- Função nova em `public` nasce com `execute` para PUBLIC — que inclui `anon`,
-- o role da chave que vai no bundle do navegador. Revoga e devolve só a quem
-- entrou. Foi a asserção 3c do teste que pegou o equivalente para views.
revoke all on function public.painel_resumo(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.painel_eventos_por_tipo(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.painel_serie_diaria(timestamptz, timestamptz, text)
  from public, anon;
revoke all on function public.painel_geo(timestamptz, timestamptz)
  from public, anon;

grant execute on function public.painel_resumo(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.painel_eventos_por_tipo(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.painel_serie_diaria(timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.painel_geo(timestamptz, timestamptz)
  to authenticated;
