-- =============================================================================
-- 0004 · Rate limiting e cache dos Insights
-- =============================================================================
-- Rate limiting em Postgres, sem Redis: mantém a promessa de que só a infra do
-- Supabase vive em variável de ambiente.
-- =============================================================================

create table if not exists public.rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- -----------------------------------------------------------------------------
-- Incrementa e responde se PODE seguir. Atômico: o INSERT ... ON CONFLICT
-- resolve a corrida entre requisições simultâneas dentro da própria linha,
-- sem SELECT-depois-UPDATE (que deixaria janela para estourar o limite).
--
-- Devolve true quando a requisição está dentro do limite.
-- -----------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $b031$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'limite e janela precisam ser positivos';
  end if;

  -- date_bin alinha o agora ao início da janela: todas as requisições do mesmo
  -- intervalo caem na mesma linha.
  v_window := date_bin(
    make_interval(secs => p_window_seconds),
    now(),
    timestamptz 'epoch'
  );

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
    do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  return v_hits <= p_limit;
end;
$b031$;

-- Janelas vencidas não servem para nada; a Fase 8 agenda esta limpeza.
create or replace function public.purge_rate_limits(p_older_than_hours integer default 24)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $b032$
declare
  v_apagadas integer;
begin
  delete from public.rate_limits
   where window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$b032$;

-- -----------------------------------------------------------------------------
-- Cache dos Insights do Meta Ads. A Meta cobra por pontuação (BUC) e pune
-- rajada; este cache é o que permite abrir a tela de Campanhas à vontade sem
-- encostar na API.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_insights_cache (
  ad_account_id text        not null,
  level         text        not null,
  date_start    date        not null,
  date_stop     date        not null,
  data          jsonb       not null,
  fetched_at    timestamptz not null default now(),
  primary key (ad_account_id, level, date_start, date_stop),
  constraint meta_insights_level_valido check (level in ('campaign', 'adset', 'ad')),
  constraint meta_insights_periodo_valido check (date_start <= date_stop)
);

create index if not exists meta_insights_fetched_idx on public.meta_insights_cache (fetched_at);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.rate_limits         enable row level security;
alter table public.meta_insights_cache enable row level security;

-- rate_limits não tem policy nenhuma: nem o painel precisa ler. Com RLS ligada
-- e zero policies, ninguém alcança a tabela a não ser o service_role.
create policy "meta_insights_cache: leitura autenticada"
  on public.meta_insights_cache for select to authenticated using (true);

revoke all on public.rate_limits from anon, authenticated;
revoke insert, update, delete, truncate
  on public.meta_insights_cache from anon, authenticated;
revoke all on public.meta_insights_cache from anon;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.purge_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.purge_rate_limits(integer) to service_role;
