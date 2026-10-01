-- =============================================================================
-- Robô não conta como visitante
-- =============================================================================
-- A conta real trouxe cinco "visitantes" de The Dalles, Oregon — datacenter do
-- Google. Rastreador e prévia de link chegam em qualquer loja aberta, e até
-- aqui entravam no topo do funil: a conversão era dividida por um denominador
-- que incluía máquina, e o gasto por visitante também.
--
-- A LINHA CONTINUA SENDO GRAVADA. Isto decide o que CONTA, não o que existe.
-- Descartar na captura perderia para sempre quem a regra classificasse errado,
-- e o falso positivo é o erro caro aqui: um comprador marcado como robô sai do
-- funil E do que vai para a Meta, sem nada apontar a falta.
--
-- A regra de verdade mora em `src/lib/robo.ts` e roda na captura. O que há
-- aqui é o preenchimento RETROATIVO de quem já estava no banco — uma vez só.
-- `robo.test.ts` quebra o build se uma marca entrar só de um lado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A coluna
-- -----------------------------------------------------------------------------
alter table public.visitors
  add column if not exists is_bot boolean not null default false;
alter table public.events_log
  add column if not exists is_bot boolean not null default false;

-- Coluna nova nasce INVISÍVEL quando a tabela virar restrita por coluna — e é
-- a tela que quebra com "permission denied", não o SQL. A asserção 3d guarda.
grant select (is_bot) on public.visitors   to authenticated;
grant select (is_bot) on public.events_log to authenticated;

-- Parciais: toda consulta do painel pede `not is_bot`, e o índice só precisa
-- cobrir esse lado. O robô fica fora do índice e não custa espaço.
create index if not exists visitors_gente_idx
  on public.visitors (created_at desc) where not is_bot;
create index if not exists events_log_gente_idx
  on public.events_log (created_at desc) where not is_bot;

-- -----------------------------------------------------------------------------
-- Quem já estava no banco
-- -----------------------------------------------------------------------------
-- `ilike any (array[...])` e não regex: a busca em `robo.ts` é por SUBSTRING,
-- e `ilike '%x%'` é exatamente isso. Numa regex o `+` de `+http` viraria
-- quantificador e a marca deixaria de casar — calado, que é o pior jeito.
-- Nenhuma marca tem `%` nem `_`, os dois curingas do LIKE; o teste confere.
--
-- O `replace` do CUBOT vem antes, como no TypeScript: é marca de celular
-- vendida no Brasil e tem "bot" no nome.
update public.visitors
   set is_bot = true
 where not is_bot
   and user_agent is not null
   and replace(lower(user_agent), 'cubot', '') ilike any (array[
      '%googlebot%',
      '%adsbot-google%',
      '%mediapartners-google%',
      '%apis-google%',
      '%feedfetcher-google%',
      '%google-inspectiontool%',
      '%googleother%',
      '%google favicon%',
      '%storebot-google%',
      '%google-extended%',
      '%bingbot%',
      '%bingpreview%',
      '%yandexbot%',
      '%duckduckbot%',
      '%baiduspider%',
      '%applebot%',
      '%petalbot%',
      '%seznambot%',
      '%facebookexternalhit%',
      '%facebookcatalog%',
      '%facebot%',
      '%meta-externalagent%',
      '%twitterbot%',
      '%linkedinbot%',
      '%pinterestbot%',
      '%slackbot%',
      '%slack-imgproxy%',
      '%telegrambot%',
      '%discordbot%',
      '%redditbot%',
      '%whatsapp/%',
      '%skypeuripreview%',
      '%embedly%',
      '%gptbot%',
      '%oai-searchbot%',
      '%chatgpt-user%',
      '%claudebot%',
      '%claude-web%',
      '%anthropic-ai%',
      '%perplexitybot%',
      '%ccbot%',
      '%bytespider%',
      '%amazonbot%',
      '%diffbot%',
      '%timpibot%',
      '%youbot%',
      '%ahrefsbot%',
      '%semrushbot%',
      '%mj12bot%',
      '%dotbot%',
      '%dataforseo%',
      '%screaming frog%',
      '%serpstatbot%',
      '%blexbot%',
      '%barkrowler%',
      '%megaindex%',
      '%seekportbot%',
      '%zoominfobot%',
      '%imagesiftbot%',
      '%lighthouse%',
      '%pagespeed%',
      '%gtmetrix%',
      '%pingdom%',
      '%uptimerobot%',
      '%statuscake%',
      '%site24x7%',
      '%newrelicpinger%',
      '%datadog%',
      '%betteruptime%',
      '%checkly%',
      '%webpagetest%',
      '%vercel-screenshot%',
      '%vercel-favicon%',
      '%headlesschrome%',
      '%phantomjs%',
      '%puppeteer%',
      '%playwright%',
      '%selenium%',
      '%cypress%',
      '%prerender%',
      '%python-requests%',
      '%python-urllib%',
      '%aiohttp%',
      '%scrapy%',
      '%curl/%',
      '%wget/%',
      '%libwww-perl%',
      '%go-http-client%',
      '%okhttp%',
      '%java/%',
      '%apache-httpclient%',
      '%guzzlehttp%',
      '%node-fetch%',
      '%axios/%',
      '%postmanruntime%',
      '%insomnia%',
      '%httpie%',
      '%restsharp%',
      '%typhoeus%',
      '%faraday%',
      '%+http%',
      '%crawler%',
      '%crawling%',
      '%spider%',
      '%scraper%',
      '%bot/%'   ]);

-- `events_log` não guarda user_agent: o evento herda do visitante dele. Daqui
-- para a frente quem grava já sabe — a rota tem o cabeçalho na mão.
update public.events_log e
   set is_bot = true
  from public.visitors v
 where v.trck_user_id = e.trck_user_id
   and v.is_bot
   and not e.is_bot;

-- -----------------------------------------------------------------------------
-- As consultas do painel
-- -----------------------------------------------------------------------------
-- `painel_resumo` ganha COLUNA, então não dá `create or replace` — o Postgres
-- recusa mudar o tipo de retorno. Dropar leva os privilégios junto, e eles
-- voltam no fim do arquivo.
--
-- A coluna nova é `robos`, e ela existe por regra deste projeto: esconder é a
-- última escolha. Tirar cinco visitantes da conta sem dizer que foram tirados
-- faria o número cair sozinho entre dois acessos à tela, e a explicação não
-- estaria em lugar nenhum.
drop function if exists public.painel_resumo(timestamptz, timestamptz);

create or replace function public.painel_resumo(de timestamptz, ate timestamptz)
returns table (
  visitantes      bigint,
  identificados   bigint,
  eventos         bigint,
  robos           bigint,
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
      where v.created_at >= de and v.created_at < ate and not v.is_bot),
    (select count(*) from public.visitors v
      where v.created_at >= de and v.created_at < ate and not v.is_bot
        and v.email_hash is not null),
    (select count(*) from public.events_log e
      where e.created_at >= de and e.created_at < ate and not e.is_bot),
    -- O que FOI tirado da conta. Sem este número a queda de visitantes não
    -- teria explicação na tela.
    (select count(*) from public.visitors v
      where v.created_at >= de and v.created_at < ate and v.is_bot),
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
    (select coalesce(sum(coalesce(p.reverted_value, p.value)), 0)
       from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status in ('estornada', 'chargeback')),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada' and p.trck_user_id is not null),
    (select count(*) from public.purchases p
      where p.created_at >= de and p.created_at < ate
        and p.status = 'aprovada' and p.trck_user_id is null);
$$;

-- A compra NÃO é filtrada por robô, e não é esquecimento: `purchases` não tem
-- a coluna porque venda não nasce de rastreador — ela entra por webhook de
-- gateway, com dinheiro atrás. Filtrar ali seria inventar um caso que não
-- existe e arriscar esconder receita de verdade.

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
  where e.created_at >= de and e.created_at < ate and not e.is_bot
  group by e.event_name
  order by 2 desc;
$$;

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
    where created_at >= de and created_at < ate and not is_bot
    group by 1
  ) v on v.dia = dias.dia
  left join (
    select (created_at at time zone fuso)::date as dia, count(*) as total
    from public.events_log
    where created_at >= de and created_at < ate and not is_bot
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
      and not is_bot
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
      and not e.is_bot
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
      and not e.is_bot
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

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------
-- Função nova em `public` nasce com `execute` para PUBLIC — que inclui `anon`,
-- o role da chave que vai no bundle do navegador. O `drop` do `painel_resumo`
-- apagou os privilégios dele junto, então os cinco são refeitos aqui.
revoke all on function public.painel_resumo(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.painel_eventos_por_tipo(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.painel_serie_diaria(timestamptz, timestamptz, text)
  from public, anon;
revoke all on function public.painel_geo_arvore(timestamptz, timestamptz)
  from public, anon;
revoke all on function public.painel_paginas(timestamptz, timestamptz)
  from public, anon;

grant execute on function public.painel_resumo(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.painel_eventos_por_tipo(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.painel_serie_diaria(timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.painel_geo_arvore(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.painel_paginas(timestamptz, timestamptz)
  to authenticated;
