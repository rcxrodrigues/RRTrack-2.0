-- =============================================================================
-- 0012 · Retenção — o que sai, o que fica, e por quê
-- =============================================================================
-- Três tabelas guardam payload cru, e payload cru é o que cresce sem limite:
-- um evento de captura tem quatro jsonb, e um webhook de venda traz o cliente
-- inteiro. Em seis meses de tráfego isso é a maior parte do banco.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A LINHA NUNCA É APAGADA. Só os campos pesados são zerados.               │
-- │                                                                           │
-- │ Data, nome do evento, UTMs e geo continuam alimentando o painel — o      │
-- │ histórico de conversão e de ROAS não pode encolher só porque o payload   │
-- │ envelheceu. Apagar a linha reescreveria o passado do faturamento.        │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- E há um segundo motivo, que não é de espaço: esses campos guardam **dado
-- pessoal** — e-mail, telefone, endereço, CPF em alguns gateways. Guardar
-- para sempre o que só serve para depurar a primeira semana é risco sem
-- contrapartida. Aqui, minimizar é a escolha certa pelos dois lados.
--
-- Prazos, e a razão de cada um:
--
--   events_log          14 dias  · depurar envio é trabalho da mesma semana
--   webhooks_recebidos  30 dias  · é com ele que se escreve adaptador novo,
--                                   e adaptador leva mais que uma semana
--   purchases.raw       90 dias  · auditoria de venda contestada. O prazo de
--                                   chargeback no cartão chega a 120 dias,
--                                   então 90 é o mínimo defensável — mas a
--                                   LINHA da venda fica para sempre
-- =============================================================================

/*
 * O `pg_cron` existe no Supabase e NÃO num Postgres comum. O bloco tolera a
 * ausência para a migration rodar inteira no teste local — a função de
 * limpeza, que é onde mora a lógica, é criada dos dois lados. O agendamento
 * se verifica no Supabase, em `cron.job` e `cron.job_run_details`.
 */
do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when others then
    raise notice 'pg_cron indisponível (esperado fora do Supabase): %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- A rotina
-- -----------------------------------------------------------------------------
-- `security definer` porque o cron roda sem usuário e precisa escrever nas
-- três tabelas — que não têm policy de escrita para ninguém, por desenho.
create or replace function private.aplicar_retencao(p_lote integer default 5000)
returns table (tabela text, linhas bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  /*
   * EM LOTES, e `purged_at` é o que torna isso possível.
   *
   * Um UPDATE sobre seis meses de eventos trava a tabela por minutos e a
   * captura para de gravar — o site inteiro perde tracking enquanto a
   * limpeza roda. Com lote e marca, cada passagem é curta e a seguinte
   * continua de onde parou.
   */
  with alvo as (
    select id from public.events_log
     where created_at < now() - interval '14 days'
       and purged_at is null
     order by created_at
     limit p_lote
     for update skip locked
  )
  update public.events_log e
     set payload_meta  = null,
         response_meta = null,
         payload_ga4   = null,
         response_ga4  = null,
         purged_at     = now()
    from alvo
   where e.id = alvo.id;

  get diagnostics v_n = row_count;
  tabela := 'events_log'; linhas := v_n; return next;

  with alvo as (
    select id from public.webhooks_recebidos
     where created_at < now() - interval '30 days'
       and (corpo is not null or corpo_texto is not null or headers is not null)
     order by created_at
     limit p_lote
     for update skip locked
  )
  update public.webhooks_recebidos w
     set corpo = null, corpo_texto = null, headers = null
    from alvo
   where w.id = alvo.id;

  get diagnostics v_n = row_count;
  tabela := 'webhooks_recebidos'; linhas := v_n; return next;

  with alvo as (
    select id from public.purchases
     where created_at < now() - interval '90 days'
       and raw_webhook is not null
     order by created_at
     limit p_lote
     for update skip locked
  )
  update public.purchases p
     set raw_webhook = null
    from alvo
   where p.id = alvo.id;

  get diagnostics v_n = row_count;
  tabela := 'purchases'; linhas := v_n; return next;
end;
$$;

comment on function private.aplicar_retencao(integer) is
  'Zera os campos pesados fora do prazo, em lotes. NUNCA apaga linha: data, evento, UTMs e geo seguem alimentando o painel.';

revoke all on function private.aplicar_retencao(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- O agendamento
-- -----------------------------------------------------------------------------
-- 04:10 UTC = 01:10 em São Paulo — fora do pico de qualquer oferta brasileira.
-- Um lote por dia basta: o volume diário é muito menor que 5.000 e a fila
-- nunca acumula. Se acumular, o índice parcial acha o que falta rápido.
do $$
begin
  perform cron.unschedule('rrtrack-retencao');
exception
  when others then null;  -- não existia ainda, ou não há pg_cron aqui
end;
$$;

do $$
begin
  perform cron.schedule(
    'rrtrack-retencao',
    '10 4 * * *',
    'select private.aplicar_retencao();'
  );
exception
  when undefined_function or invalid_schema_name then
    -- Substituto de teste: agenda na tabela falsa só para a asserção ver.
    perform extensions.cron_schedule(
      'rrtrack-retencao',
      '10 4 * * *',
      'select private.aplicar_retencao();'
    );
end;
$$;
