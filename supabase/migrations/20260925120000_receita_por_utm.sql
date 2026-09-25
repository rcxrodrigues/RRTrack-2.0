-- =============================================================================
-- 0011 · Receita por UTM — o outro lado do ROAS
-- =============================================================================
-- O gasto vem da Meta; a receita vem daqui. O que os cruza é a UTM de
-- campanha, e é por isso que ela precisa ser agregada no banco: o painel não
-- pode baixar toda venda para somar em JavaScript.
--
-- **Só `aprovada`.** É a regra do projeto inteira em uma linha: pendente é
-- boleto que ninguém pagou, estornada é dinheiro que voltou. O ROAS que vale
-- é sobre o que ficou no caixa — e é ele que vai divergir do da Meta, que
-- não tem reversão.
--
-- `sem_atribuicao` conta à parte, e não é detalhe: é receita real que NÃO
-- entra em campanha nenhuma. Sem esse número, o ROAS parece pior do que é e
-- ninguém sabe o quanto.
-- =============================================================================

create or replace function public.painel_receita_por_utm(
  de timestamptz,
  ate timestamptz
)
returns table (
  utm_campaign  text,
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
    coalesce(p.utm_source, ''),
    count(*),
    coalesce(sum(p.value), 0)
  from public.purchases p
  where p.created_at >= de
    and p.created_at <  ate
    and p.status = 'aprovada'
  group by 1, 2
  order by 4 desc;
$$;

comment on function public.painel_receita_por_utm(timestamptz, timestamptz) is
  'Receita aprovada por utm_campaign e utm_source. A campanha vazia agrupa a venda sem atribuição — que é receita real fora de campanha nenhuma.';

-- Função nova em `public` nasce com `execute` para PUBLIC, que inclui `anon`
-- — o role da chave que vai no bundle do navegador. Ver a asserção 8.
revoke all on function public.painel_receita_por_utm(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.painel_receita_por_utm(timestamptz, timestamptz)
  to authenticated;
