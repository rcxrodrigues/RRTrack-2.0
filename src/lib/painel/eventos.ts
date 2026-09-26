import 'server-only';

import { texto as textoEm } from '@/lib/json';
import { resolverOrigem, type Origem, type Utms } from '@/lib/painel/origem';
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
  /**
   * Conjunto e anúncio, quando a macro do anúncio os escreveu.
   *
   * A Meta não manda adset nem ad no evento — quem os traz é a UTM, pela
   * convenção `{{adset.name}}` em `utm_term` e `{{ad.name}}` em
   * `utm_content`. Por isso a tela rotula como "pela UTM": se a macro não
   * estiver no anúncio, estes campos vêm vazios e o problema é lá, não aqui.
   */
  utmTerm: string | null;
  utmContent: string | null;
  url: string | null;
  pais: string | null;
  regiao: string | null;
  cidade: string | null;
  /** Quando a retenção já zerou os campos pesados desta linha. */
  purgado: boolean;
  criadoEm: string;
  /**
   * De onde a pessoa veio — resolvido em cascata, ver `origem.ts`.
   *
   * Não é só decoração da coluna de campanha: a UTM é lida da URL de cada
   * evento, então só o PageView de entrada costuma tê-la. Sem a cascata, a
   * MAIORIA das linhas dizia "sem campanha na UTM" — o que lia como falha
   * de marcação e era navegação normal.
   */
  origem: Origem;
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
  'utm_term, utm_content, event_source_url, geo_country, geo_region, ' +
  'geo_city, purged_at, created_at';

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
        utmTerm: textoEm(linha, 'utm_term') ?? null,
        utmContent: textoEm(linha, 'utm_content') ?? null,
        url: textoEm(linha, 'event_source_url') ?? null,
        pais: textoEm(linha, 'geo_country') ?? null,
        regiao: textoEm(linha, 'geo_region') ?? null,
        cidade: textoEm(linha, 'geo_city') ?? null,
        purgado: textoEm(linha, 'purged_at') !== undefined,
        criadoEm,
      },
    ];
  });

  /*
   * O visitante de cada linha, numa consulta só.
   *
   * `referrer` e as UTMs da primeira visita vivem em `visitors`, não em
   * `events_log` — e é o certo: são propriedade da VISITA, não de cada
   * evento. Gravá-las em toda linha de evento seria repetir o mesmo dado
   * centenas de vezes por pessoa.
   *
   * Uma consulta por página de eventos, com `in` sobre a coluna indexada e
   * no máximo `POR_PAGINA` ids distintos. Não é N+1: é 1+1.
   */
  const ids = [
    ...new Set(linhas.flatMap((l) => (l.trckUserId === null ? [] : [l.trckUserId]))),
  ];
  const visitantes = await utmsDosVisitantes(supabase, ids);

  /*
   * `Object.assign` e não espalhamento: as linhas acabaram de ser criadas
   * logo acima e não são vistas por ninguém, então acrescentar o campo nelas
   * é seguro — e espalhar copiaria cinquenta objetos de quinze campos à toa.
   * É o que o `no-map-spread` do oxlint aponta.
   */
  const comOrigem = linhas.map((l) => {
    const visitante = l.trckUserId === null ? null : visitantes.get(l.trckUserId);
    return Object.assign(l, {
      origem: resolverOrigem({
        doEvento: l,
        doVisitante: visitante,
        referrer: visitante?.referrer ?? null,
      }),
    });
  });

  return { linhas: comOrigem, total: count ?? 0 };
}

/** As UTMs e o referrer da primeira visita, por `trck_user_id`. */
type UtmsDoVisitante = Utms & { referrer: string | null };

async function utmsDosVisitantes(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  ids: string[],
): Promise<Map<string, UtmsDoVisitante>> {
  const mapa = new Map<string, UtmsDoVisitante>();
  if (ids.length === 0) return mapa;

  const { data, error } = await supabase
    .from('visitors')
    .select(
      'trck_user_id, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content',
    )
    .in('trck_user_id', ids);

  if (error) {
    // Falhar aqui não pode esvaziar a tabela de eventos: sem o visitante a
    // origem cai para "direto", que é pior do que a verdade mas ainda é uma
    // tela funcionando. O erro fica no log.
    console.error('[painel] utms do visitante falharam:', error.message);
    return mapa;
  }

  for (const linha of Array.isArray(data) ? data : []) {
    const id = textoEm(linha, 'trck_user_id');
    if (id === undefined) continue;
    mapa.set(id, {
      referrer: textoEm(linha, 'referrer') ?? null,
      utmSource: textoEm(linha, 'utm_source') ?? null,
      utmMedium: textoEm(linha, 'utm_medium') ?? null,
      utmCampaign: textoEm(linha, 'utm_campaign') ?? null,
      utmTerm: textoEm(linha, 'utm_term') ?? null,
      utmContent: textoEm(linha, 'utm_content') ?? null,
    });
  }

  return mapa;
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

/** O corpo e os cabeçalhos de um webhook guardado — ver `buscarCorpoDoWebhook`. */
export type CorpoDoWebhook = {
  corpo: unknown;
  corpoTexto: string | null;
  headers: Record<string, string> | null;
};

/**
 * O payload de um webhook, sob demanda.
 *
 * MESMA razão do `buscarPayload` acima, e a lista de webhooks tinha ficado de
 * fora: `corpo` é o pedido inteiro do gateway — cliente, itens, endereço —, e
 * um payload de checkout passa de dez quilobytes com folga. Cinquenta linhas
 * viajavam com os cinquenta corpos no payload do RSC **com todas as linhas
 * fechadas**, em toda abertura da aba. Eram centenas de quilobytes para
 * mostrar cinco badges e cinco datas.
 *
 * Os cabeçalhos vêm daqui pelo mesmo motivo. O token já sai mascarado na
 * gravação (`cabecalhosSeguros`), então o que trafega aqui é o que a tela
 * mostra — só deixa de trafegar quando ninguém pediu.
 */
export async function buscarCorpoDoWebhook(
  id: string,
): Promise<CorpoDoWebhook | null> {
  const supabase = await criarClienteServidor();

  // `returns<...>` em vez de uma asserção de tipo: o oxlint recusa
  // `as` inseguro, e aqui a forma da linha é conhecida pelo `select`.
  const { data, error } = await supabase
    .from('webhooks_recebidos')
    .select('corpo, corpo_texto, headers')
    .eq('id', id)
    .returns<
      {
        corpo: unknown;
        corpo_texto: string | null;
        headers: Record<string, string> | null;
      }[]
    >()
    .maybeSingle();

  if (error) {
    console.error('[painel] corpo do webhook falhou:', error.message);
    return null;
  }
  if (!data) return null;

  return {
    corpo: data.corpo ?? null,
    corpoTexto: data.corpo_texto ?? null,
    headers: data.headers ?? null,
  };
}

export type EventoDoVisitante = {
  id: string;
  nome: string;
  url: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  purgado: boolean;
  criadoEm: string;
};

export type Visitante = {
  trckUserId: string;
  email: string | null;
  telefone: string | null;
  primeiroNome: string | null;
  sobrenome: string | null;
  /** Presença, NUNCA o valor: ver o aviso em `carregarVisitante`. */
  temFbp: boolean;
  temFbc: boolean;
  gaClientId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  landingUrl: string | null;
  pais: string | null;
  regiao: string | null;
  cidade: string | null;
  criadoEm: string;
  eventos: EventoDoVisitante[];
};

/**
 * Tudo que se sabe de um visitante, mais o histórico dele.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ OS HASHES E OS COOKIES NÃO SOBEM PARA A TELA.                            │
 * │                                                                          │
 * │ `email_hash` e afins não dizem nada a quem olha — o e-mail em claro está │
 * │ ao lado e é o que serve para conferir. E `fbp`/`fbc` são identificadores │
 * │ de rastreio do navegador: o que a tela precisa responder é "a Meta tem   │
 * │ com quem casar?", que é uma pergunta de presença, não de valor. Mandar   │
 * │ o valor seria copiar dado de rastreio para dentro de um HTML que não     │
 * │ precisa dele.                                                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O histórico é limitado: um visitante ativo tem centenas de PageView, e a
 * gaveta não é relatório.
 */
const EVENTOS_DO_VISITANTE = 50;

export async function carregarVisitante(
  trckUserId: string,
): Promise<Visitante | null> {
  const supabase = await criarClienteServidor();

  const [{ data: v }, { data: eventos }] = await Promise.all([
    supabase
      .from('visitors')
      .select(
        'trck_user_id, email, phone, first_name, last_name, fbp, fbc, ' +
          'ga_client_id, utm_source, utm_medium, utm_campaign, utm_term, ' +
          'utm_content, referrer, landing_url, geo_country, geo_region, ' +
          'geo_city, created_at',
      )
      .eq('trck_user_id', trckUserId)
      .maybeSingle(),
    supabase
      .from('events_log')
      .select(
        'id, event_name, event_source_url, utm_source, utm_campaign, ' +
          'utm_term, utm_content, purged_at, created_at',
      )
      .eq('trck_user_id', trckUserId)
      .order('created_at', { ascending: false })
      .limit(EVENTOS_DO_VISITANTE),
  ]);

  /*
   * Visitante ausente com eventos presentes NÃO é erro: o `/api/event` grava
   * o evento mesmo quando o `/api/identify` ainda não rodou. Devolver `null`
   * aqui esconderia o histórico de quem mais interessa depurar.
   */
  const historico: EventoDoVisitante[] = (Array.isArray(eventos) ? eventos : [])
    .flatMap((linha) => {
      const id = textoEm(linha, 'id');
      const nome = textoEm(linha, 'event_name');
      const criadoEm = textoEm(linha, 'created_at');
      if (id === undefined || nome === undefined || criadoEm === undefined) return [];
      return [
        {
          id,
          nome,
          url: textoEm(linha, 'event_source_url') ?? null,
          utmSource: textoEm(linha, 'utm_source') ?? null,
          utmCampaign: textoEm(linha, 'utm_campaign') ?? null,
          utmTerm: textoEm(linha, 'utm_term') ?? null,
          utmContent: textoEm(linha, 'utm_content') ?? null,
          purgado: textoEm(linha, 'purged_at') !== undefined,
          criadoEm,
        },
      ];
    });

  if (!v && historico.length === 0) return null;

  return {
    trckUserId,
    email: textoEm(v, 'email') ?? null,
    telefone: textoEm(v, 'phone') ?? null,
    primeiroNome: textoEm(v, 'first_name') ?? null,
    sobrenome: textoEm(v, 'last_name') ?? null,
    // Presença, não valor — ver o aviso acima.
    temFbp: textoEm(v, 'fbp') !== undefined,
    temFbc: textoEm(v, 'fbc') !== undefined,
    gaClientId: textoEm(v, 'ga_client_id') ?? null,
    utmSource: textoEm(v, 'utm_source') ?? null,
    utmMedium: textoEm(v, 'utm_medium') ?? null,
    utmCampaign: textoEm(v, 'utm_campaign') ?? null,
    utmTerm: textoEm(v, 'utm_term') ?? null,
    utmContent: textoEm(v, 'utm_content') ?? null,
    referrer: textoEm(v, 'referrer') ?? null,
    landingUrl: textoEm(v, 'landing_url') ?? null,
    pais: textoEm(v, 'geo_country') ?? null,
    regiao: textoEm(v, 'geo_region') ?? null,
    cidade: textoEm(v, 'geo_city') ?? null,
    criadoEm: textoEm(v, 'created_at') ?? (historico.at(-1)?.criadoEm ?? ''),
    eventos: historico,
  };
}
