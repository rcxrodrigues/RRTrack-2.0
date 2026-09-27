-- =============================================================================
-- 0017 · A retenção não come o payload que ainda deve trabalho
-- =============================================================================
-- Dois defeitos, os dois calados, os dois na retenção de `webhooks_recebidos`.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ 1) O PRAZO ERA UM SÓ, E O PAYLOAD QUE AINDA PEDE AÇÃO MORRIA COM ELE.    │
-- │                                                                           │
-- │ Aos 30 dias o `corpo` era zerado em TODA linha — inclusive nas duas que   │
-- │ o painel pinta pedindo ação:                                              │
-- │                                                                           │
-- │   amarelo  (`adaptador is null`)  ninguém reconheceu o formato. É este    │
-- │                                   payload que se lê para escrever o       │
-- │                                   adaptador novo.                         │
-- │   vermelho (`motivo is not null`) reconhecido e não soube ler. Vira venda │
-- │                                   no minuto em que o cadastro entra e     │
-- │                                   alguém clica em Reprocessar.            │
-- │                                                                           │
-- │ O gateway não reenvia para sempre: a Appmax desiste depois de quatro      │
-- │ tentativas, em definitivo e sem avisar. Zerado o corpo, a venda não       │
-- │ volta nunca mais — e o painel continuava exibindo a linha como se         │
-- │ houvesse o que fazer.                                                     │
-- │                                                                           │
-- │ Agora o prazo depende do estado: 30 dias para quem já foi tratado (ali    │
-- │ o corpo é material de consulta), 90 para quem ainda pede ação — o mesmo   │
-- │ prazo de `purchases.raw_webhook`, que é o teto que este sistema já        │
-- │ aceita para dado pessoal de webhook. Três meses sem ninguém agir é       │
-- │ prazo real, não arbitrário: passou o retry de qualquer gateway, passou    │
-- │ o chargeback e passou a campanha.                                         │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ 2) `corpo is null` TINHA DOIS SIGNIFICADOS, E A TELA ESCOLHEU O ERRADO.  │
-- │                                                                           │
-- │   · não era JSON válido  → `corpo` nulo, `corpo_texto` com o texto cru    │
-- │   · a retenção zerou     → os dois nulos                                  │
-- │                                                                           │
-- │ A tela dizia "(não era JSON válido)" nos dois casos, e o Reprocessar      │
-- │ respondia "O corpo não era JSON válido; não há o que reprocessar." Para   │
-- │ uma linha zerada pela retenção isso é mentira, e manda a pessoa depurar   │
-- │ o gateway quando o problema é prazo nosso.                                │
-- │                                                                           │
-- │ `purged_at` desfaz a ambiguidade, como `events_log` já fazia. Deduzir     │
-- │ pelos dois campos nulos funcionaria hoje e é o mesmo erro do `platform`   │
-- │ como proxy de camada: usar sintoma no lugar do fato.                      │
-- └───────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

alter table public.webhooks_recebidos
  add column if not exists purged_at timestamptz;

comment on column public.webhooks_recebidos.purged_at is
  'Quando a retenção zerou corpo/corpo_texto/headers. NULL = nunca zerada. Existe porque `corpo is null` também acontece quando o gateway manda algo que não é JSON, e a tela precisa dizer qual dos dois foi.';

/*
 * Índice do varredor: ele pede as mais antigas AINDA não zeradas, em ordem
 * crescente. Parcial, porque o estado normal de uma linha velha é já estar
 * zerada — sem o `where`, o índice cresceria com a tabela e a varredura
 * passaria por tudo que já foi feito.
 */
create index if not exists webhooks_recebidos_retencao_idx
  on public.webhooks_recebidos (created_at) where purged_at is null;

-- -----------------------------------------------------------------------------
-- A rotina, com o prazo por estado
-- -----------------------------------------------------------------------------
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

  /*
   * Aqui o prazo depende do ESTADO da linha, não só da idade.
   *
   * Verde (reconhecido, sem pendência) são a maioria e já cumpriram o papel:
   * 30 dias. Amarelo e vermelho ainda podem virar venda com um clique, e é
   * exatamente o corpo deles que o Reprocessar precisa: 90 dias.
   *
   * `purged_at is null` no lugar do antigo "algum dos três campos não é
   * nulo": a marca é o fato, e o teste pelos campos confundia linha zerada
   * com linha que chegou sem nada. De quebra, a primeira passagem estampa
   * as que já haviam sido zeradas antes desta migration — a data fica
   * aproximada nelas, mas o fato passa a estar registrado, que é o que a
   * tela precisa. (Neste banco não há nenhuma: nada chegou aos 30 dias.)
   */
  with alvo as (
    select id from public.webhooks_recebidos
     where purged_at is null
       and (
         case
           when adaptador is not null and motivo is null
             then created_at < now() - interval '30 days'
           else created_at < now() - interval '90 days'
         end
       )
     order by created_at
     limit p_lote
     for update skip locked
  )
  update public.webhooks_recebidos w
     set corpo       = null,
         corpo_texto = null,
         headers     = null,
         purged_at   = now()
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
  'Zera os campos pesados fora do prazo, em lotes. NUNCA apaga linha: data, evento, UTMs e geo seguem alimentando o painel. Webhook que ainda pede ação (amarelo ou vermelho) guarda o corpo por 90 dias, não 30 — é dele que sai a venda reprocessada.';

revoke all on function private.aplicar_retencao(integer) from public, anon, authenticated;
