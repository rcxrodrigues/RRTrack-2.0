-- =============================================================================
-- 0014 · Receita por UTM, nos três níveis
-- =============================================================================
-- A árvore de campanhas mostra gasto em campanha, conjunto e anúncio. Para o
-- ROAS descer junto, a receita precisa vir quebrada pelos mesmos três — e a
-- função anterior só agrupava por campanha.
--
-- A convenção é a das macros do anúncio:
--   utm_campaign = {{campaign.name}}
--   utm_term     = {{adset.name}}
--   utm_content  = {{ad.name}}
--
-- **Onde a macro não estiver no anúncio, o campo chega vazio** — e aí o ROAS
-- daquele nível é `—`, não zero. Zero afirmaria que o anúncio não vendeu; o
-- que houve foi a UTM não ter dito de qual anúncio a venda veio.
--
-- A função antiga fica: ela é usada pela tela que não precisa da árvore, e
-- trocar a assinatura de uma função já aplicada quebraria o painel no
-- intervalo entre o deploy e a migration.
-- =============================================================================

create or replace function public.painel_receita_por_utm_completa(
  de timestamptz,
  ate timestamptz
)
returns table (
  utm_campaign  text,
  utm_term      text,
  utm_content   text,
  utm_source    text,
  vendas        bigint,
  receita       numeric
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(p.utm_campaign, ''),
    coalesce(p.utm_term, ''),
    coalesce(p.utm_content, ''),
    coalesce(p.utm_source, ''),
    count(*),
    coalesce(sum(p.value), 0)
  from public.purchases p
  where p.created_at >= de
    and p.created_at <  ate
    and p.status = 'aprovada'
  group by 1, 2, 3, 4
  order by 6 desc;
$$;

comment on function public.painel_receita_por_utm_completa(timestamptz, timestamptz) is
  'Receita aprovada quebrada pelos três níveis da árvore da Meta: utm_campaign, utm_term (conjunto) e utm_content (anúncio). Campo vazio significa que a macro não estava no anúncio.';

-- Função nova em `public` nasce com `execute` para PUBLIC, que inclui `anon`
-- — o role da chave que vai no bundle do navegador. Ver a asserção 8.
revoke all on function public.painel_receita_por_utm_completa(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.painel_receita_por_utm_completa(timestamptz, timestamptz)
  to authenticated;
