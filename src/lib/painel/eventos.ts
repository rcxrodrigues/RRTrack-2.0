import 'server-only';

import { texto as textoEm } from '@/lib/json';
import { criarClienteServidor } from '@/lib/supabase/server';

import type { Intervalo } from './periodo';

/**
 * A lista de eventos capturados.
 *
 * **Sem os payloads.** `payload_meta`, `response_meta`, `payload_ga4` e
 * `response_ga4` são jsonb grandes: cinquenta linhas com os quatro dariam
 * megabytes numa tela que mostra vinte campos. Eles são buscados um a um,
 * quando a pessoa abre a linha — ver `buscarPayload`.
 */

export const POR_PAGINA = 50;

/** Teto da paginação — ver a nota em `lerFiltro`. */
const TETO_DE_PAGINA = 1_000_000;

export type LinhaEvento = {
  id: string;
  eventId: string;
  nome: string;
  trckUserId: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  url: string | null;
  pais: string | null;
  cidade: string | null;
  /** Quando a retenção já zerou os campos pesados desta linha. */
  purgado: boolean;
  criadoEm: string;
};

export type FiltroEventos = {
  /** `event_name` exato, ou vazio para todos. */
  nome: string;
  /** Prefixo de `trck_user_id` ou `event_id`. */
  busca: string;
  /** Base zero. */
  pagina: number;
};

const COLUNAS =
  'id, event_id, event_name, trck_user_id, utm_source, utm_campaign, ' +
  'event_source_url, geo_country, geo_city, purged_at, created_at';

/** O primeiro valor: o parâmetro repetido na URL chega como lista. */
function um(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

export function lerFiltro(
  params: Record<string, string | string[] | undefined>,
): FiltroEventos {
  const pagina = Number.parseInt(um(params.pagina), 10);

  return {
    nome: um(params.nome).slice(0, 80),
    busca: um(params.busca).trim().slice(0, 80),
    /*
     * Página inválida vira a primeira, e página absurda é limitada.
     *
     * O teto não é capricho: `pagina * POR_PAGINA` vira o OFFSET, e um
     * número grande o bastante estoura o `bigint` do Postgres — a consulta
     * falha em vez de devolver lista vazia. Query string é sugestão.
     */
    pagina:
      Number.isFinite(pagina) && pagina > 0 ? Math.min(pagina, TETO_DE_PAGINA) : 0,
  };
}

export async function buscarEventos(
  intervalo: Intervalo,
  filtro: FiltroEventos,
): Promise<{ linhas: LinhaEvento[]; total: number }> {
  const supabase = await criarClienteServidor();

  let consulta = supabase
    .from('events_log')
    // `count: 'exact'` para a paginação saber onde termina. Em tabela muito
    // grande isto custa; quando custar, o caminho é `planned`.
    .select(COLUNAS, { count: 'exact' })
    .gte('created_at', intervalo.de.toISOString())
    .lt('created_at', intervalo.ate.toISOString());

  if (filtro.nome) consulta = consulta.eq('event_name', filtro.nome);

  if (filtro.busca) {
    /*
     * `or` com dois prefixos. O `%` no fim e não nos dois lados de
     * propósito: `%texto%` não usa índice, e estas duas colunas são
     * justamente as indexadas. Quem cola um id inteiro acha; quem cola um
     * pedaço do meio, não — e é um preço melhor que varrer a tabela.
     */
    const seguro = filtro.busca.replaceAll(/[%,()]/g, '');
    if (seguro) {
      consulta = consulta.or(
        `trck_user_id.like.${seguro}%,event_id.like.${seguro}%`,
      );
    }
  }

  const inicio = filtro.pagina * POR_PAGINA;

  const { data, count, error } = await consulta
    .order('created_at', { ascending: false })
    .range(inicio, inicio + POR_PAGINA - 1);

  if (error) {
    console.error('[painel] eventos falhou:', error.message);
    return { linhas: [], total: 0 };
  }

  const linhas = (Array.isArray(data) ? data : []).flatMap((linha) => {
    const id = textoEm(linha, 'id');
    const nome = textoEm(linha, 'event_name');
    const criadoEm = textoEm(linha, 'created_at');
    if (id === undefined || nome === undefined || criadoEm === undefined) {
      return [];
    }

    return [
      {
        id,
        eventId: textoEm(linha, 'event_id') ?? '',
        nome,
        trckUserId: textoEm(linha, 'trck_user_id') ?? null,
        utmSource: textoEm(linha, 'utm_source') ?? null,
        utmCampaign: textoEm(linha, 'utm_campaign') ?? null,
        url: textoEm(linha, 'event_source_url') ?? null,
        pais: textoEm(linha, 'geo_country') ?? null,
        cidade: textoEm(linha, 'geo_city') ?? null,
        purgado: textoEm(linha, 'purged_at') !== undefined,
        criadoEm,
      },
    ];
  });

  return { linhas, total: count ?? 0 };
}

export type PayloadDoEvento = {
  payloadMeta: unknown;
  respostaMeta: unknown;
  payloadGa4: unknown;
  respostaGa4: unknown;
  purgado: boolean;
};

/**
 * Os payloads de UM evento, buscados quando a linha abre.
 *
 * A retenção (Fase 8) zera estes campos depois de 14 dias e marca
 * `purged_at`, mantendo a linha. `purgado` é o que permite a tela dizer "foi
 * zerado pela retenção" em vez de mostrar vazio e parecer que o envio falhou.
 */
export async function buscarPayload(id: string): Promise<PayloadDoEvento | null> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('events_log')
    .select('payload_meta, response_meta, payload_ga4, response_ga4, purged_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[painel] payload do evento falhou:', error.message);
    return null;
  }
  if (!data) return null;

  return {
    payloadMeta: data.payload_meta ?? null,
    respostaMeta: data.response_meta ?? null,
    payloadGa4: data.payload_ga4 ?? null,
    respostaGa4: data.response_ga4 ?? null,
    purgado: textoEm(data, 'purged_at') !== undefined,
  };
}
