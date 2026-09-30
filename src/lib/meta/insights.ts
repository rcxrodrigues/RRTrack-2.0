import 'server-only';

import { segredoDaContaDeAnuncio } from '@/lib/destinos';
import { lista, numero, texto } from '@/lib/json';
import { metaInsightsEndpoint } from '@/lib/meta/constants';
import { lerUso, TETO_DE_USO } from '@/lib/meta/buc';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * Os Insights da Meta — gasto por campanha, conjunto e anúncio.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Três travas, e nenhuma é excesso de zelo:                                │
 * │                                                                           │
 * │ 1. CACHE. O gasto de ontem não muda; o de hoje muda devagar. Buscar a    │
 * │    cada abertura de tela queima pontuação por nada.                      │
 * │ 2. FILA SERIAL. Uma requisição por vez, por conta. Em paralelo, três     │
 * │    chamadas leem a pontuação ANTES de qualquer uma responder — e as      │
 * │    três passam pelo teto juntas.                                          │
 * │ 3. TETO DE 25%. Ver `buc.ts`: estourar bloqueia a conta por até uma      │
 * │    hora, e aí o painel não mostra ROAS nenhum.                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type NivelInsights = 'campaign' | 'adset' | 'ad';

export type LinhaInsights = {
  id: string;
  nome: string;
  /** O id do nível acima — para montar a árvore. */
  paiId: string | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  /** O que a META diz que converteu. O nosso número é outro, e é o que vale. */
  comprasDaMeta: number;
  receitaDaMeta: number;
};

export type ResultadoInsights = {
  linhas: LinhaInsights[];
  /** De quando é o dado. `null` quando veio agora da Meta. */
  cacheDe: string | null;
  /** O que impediu de buscar, quando impediu. */
  aviso: string | null;
};

/**
 * Quanto tempo o cache vale.
 *
 * Quinze minutos é o meio-termo: gasto de mídia não muda de minuto a minuto,
 * e quem abre o painel cinco vezes seguidas para conferir um número não
 * deveria gastar cinco vezes a pontuação por isso.
 */
const TTL_CACHE_MS = 15 * 60_000;

/** Fila por conta: uma requisição por vez. Ver a trava 2 no topo. */
const filas = new Map<string, Promise<unknown>>();

function emFila<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
  const anterior = filas.get(chave) ?? Promise.resolve();
  // `catch` antes de encadear: uma falha não pode travar a fila para sempre.
  const proxima = anterior.catch(() => undefined).then(tarefa);
  filas.set(chave, proxima.catch(() => undefined));
  return proxima;
}

const CAMPOS: Record<NivelInsights, string> = {
  campaign: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',
  adset:
    'adset_id,adset_name,campaign_id,spend,impressions,clicks,actions,action_values',
  ad: 'ad_id,ad_name,adset_id,spend,impressions,clicks,actions,action_values',
};

const IDENTIDADE: Record<NivelInsights, { id: string; nome: string; pai: string | null }> = {
  campaign: { id: 'campaign_id', nome: 'campaign_name', pai: null },
  adset: { id: 'adset_id', nome: 'adset_name', pai: 'campaign_id' },
  ad: { id: 'ad_id', nome: 'ad_name', pai: 'adset_id' },
};

/** `YYYY-MM-DD` de um instante, no fuso pedido. */
function comoData(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

export async function buscarInsights({
  contaId,
  adAccountId,
  nivel,
  de,
  ate,
  fuso,
}: {
  /** O id da linha em `meta_ad_accounts` — é por ele que se lê o token. */
  contaId: string;
  adAccountId: string;
  nivel: NivelInsights;
  de: Date;
  ate: Date;
  fuso: string;
}): Promise<ResultadoInsights> {
  /*
   * O `ate` do intervalo é EXCLUSIVO; o da Meta é inclusivo. Sem o -1 dia,
   * um período de "7 dias" pediria 8 à Meta e o gasto não bateria com a
   * receita — e um ROAS que não fecha é pior que ROAS nenhum.
   */
  const dataDe = comoData(de, fuso);
  const dataAte = comoData(new Date(ate.getTime() - 86_400_000), fuso);

  const doCache = await lerCache(adAccountId, nivel, dataDe, dataAte);
  if (doCache && Date.now() - Date.parse(doCache.fetchedAt) < TTL_CACHE_MS) {
    return { linhas: doCache.linhas, cacheDe: doCache.fetchedAt, aviso: null };
  }

  const token = await segredoDaContaDeAnuncio(contaId);
  if (!token) {
    return {
      linhas: doCache?.linhas ?? [],
      cacheDe: doCache?.fetchedAt ?? null,
      aviso: 'a conta de anúncio não tem token cadastrado',
    };
  }

  return emFila(adAccountId, async () => {
    const url = new URL(metaInsightsEndpoint(adAccountId));
    url.searchParams.set('level', nivel);
    url.searchParams.set('fields', CAMPOS[nivel]);
    url.searchParams.set(
      'time_range',
      JSON.stringify({ since: dataDe, until: dataAte }),
    );
    url.searchParams.set('limit', '500');

    try {
      const resposta = await fetch(url, {
        method: 'GET',
        /*
         * O token vai no CABEÇALHO, nunca na query.
         *
         * Query string aparece em log de proxy e em histórico de erro. Este
         * token LÊ a conta de anúncio inteira — gasto, criativo, público.
         */
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      const uso = lerUso(resposta.headers.get('x-business-use-case-usage'));

      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        // Nunca loga o corpo inteiro: erro da Meta pode vir com eco do que
        // foi mandado, e ali dentro há id de conta e de criativo.
        console.error(
          '[insights] a Meta recusou:',
          resposta.status,
          texto(corpo, 'error') ?? '',
        );
        return {
          linhas: doCache?.linhas ?? [],
          cacheDe: doCache?.fetchedAt ?? null,
          aviso:
            uso.bloqueadoPor > 0
              ? `a Meta bloqueou a conta por ${String(Math.ceil(uso.bloqueadoPor / 60))} min`
              : `a Meta recusou a consulta (${String(resposta.status)})`,
        };
      }

      const corpo: unknown = await resposta.json();
      const linhas = lista(corpo, 'data').map((linha) => lerLinha(linha, nivel));

      await gravarCache(adAccountId, nivel, dataDe, dataAte, linhas);

      return {
        linhas,
        cacheDe: null,
        aviso: uso.acimaDoTeto
          ? `uso em ${String(Math.round(uso.percentual))}% da cota — o próximo pedido espera o cache (teto nosso: ${String(TETO_DE_USO)}%)`
          : null,
      };
    } catch (erro) {
      console.error(
        '[insights] falha ao consultar:',
        erro instanceof Error ? erro.message : erro,
      );
      // Cache velho é melhor que tela vazia: um número de ontem com a data
      // dita é informação; um branco não é.
      return {
        linhas: doCache?.linhas ?? [],
        cacheDe: doCache?.fetchedAt ?? null,
        aviso: 'não consegui falar com a Meta agora',
      };
    }
  });
}

/**
 * Uma linha dos Insights.
 *
 * `actions` e `action_values` são listas de `{action_type, value}` — a Meta
 * não devolve "compras" num campo próprio. `omni_purchase` é a soma de todos
 * os caminhos (site, app, offline); é o que corresponde ao que o Events
 * Manager mostra.
 */
function lerLinha(linha: unknown, nivel: NivelInsights): LinhaInsights {
  const campos = IDENTIDADE[nivel];

  const deAcao = (chave: string, tipo: string): number => {
    for (const acao of lista(linha, chave)) {
      if (texto(acao, 'action_type') === tipo) {
        return Number(texto(acao, 'value') ?? numero(acao, 'value') ?? 0);
      }
    }
    return 0;
  };

  return {
    id: texto(linha, campos.id) ?? '',
    nome: texto(linha, campos.nome) ?? '(sem nome)',
    paiId: campos.pai ? (texto(linha, campos.pai) ?? null) : null,
    // A Meta devolve `spend` como STRING. Somar sem converter concatena.
    gasto: Number(texto(linha, 'spend') ?? 0),
    impressoes: Number(texto(linha, 'impressions') ?? 0),
    cliques: Number(texto(linha, 'clicks') ?? 0),
    comprasDaMeta: deAcao('actions', 'omni_purchase'),
    receitaDaMeta: deAcao('action_values', 'omni_purchase'),
  };
}

type Guardado = { linhas: LinhaInsights[]; fetchedAt: string };

/** Uma linha do cache, reconstruída campo a campo. Ver a nota em `lerCache`. */
function lerLinhaDoCache(linha: unknown): LinhaInsights {
  const num = (campo: string): number => numero(linha, campo) ?? 0;
  return {
    id: texto(linha, 'id') ?? '',
    nome: texto(linha, 'nome') ?? '(sem nome)',
    paiId: texto(linha, 'paiId') ?? null,
    gasto: num('gasto'),
    impressoes: num('impressoes'),
    cliques: num('cliques'),
    comprasDaMeta: num('comprasDaMeta'),
    receitaDaMeta: num('receitaDaMeta'),
  };
}

async function lerCache(
  adAccountId: string,
  level: NivelInsights,
  dateStart: string,
  dateStop: string,
): Promise<Guardado | null> {
  try {
    const supabase = await criarClienteServidor();
    const { data } = await supabase
      .from('meta_insights_cache')
      .select('data, fetched_at')
      .eq('ad_account_id', adAccountId)
      .eq('level', level)
      .eq('date_start', dateStart)
      .eq('date_stop', dateStop)
      .maybeSingle();

    if (!data) return null;
    const fetchedAt = texto(data, 'fetched_at');
    if (!fetchedAt) return null;

    /*
     * O jsonb volta como `unknown`. Reconstruir linha a linha em vez de
     * afirmar o tipo: o cache pode ter sido gravado por uma versão anterior
     * do código, e um campo que mudou de nome viraria `NaN` na soma do ROAS
     * sem ninguém notar.
     */
    return { linhas: lista(data, 'data').map((l) => lerLinhaDoCache(l)), fetchedAt };
  } catch {
    return null;
  }
}

async function gravarCache(
  adAccountId: string,
  level: NivelInsights,
  dateStart: string,
  dateStop: string,
  linhas: LinhaInsights[],
): Promise<void> {
  try {
    await criarClienteAdmin().from('meta_insights_cache').upsert(
      {
        ad_account_id: adAccountId,
        level,
        date_start: dateStart,
        date_stop: dateStop,
        data: linhas,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'ad_account_id,level,date_start,date_stop' },
    );
  } catch (erro) {
    // Falhar o cache não pode derrubar a tela: o dado já está em mãos.
    console.error(
      '[insights] não consegui gravar o cache:',
      erro instanceof Error ? erro.message : erro,
    );
  }
}

// ---------------------------------------------------------------------------
// A série DIÁRIA de gasto
// ---------------------------------------------------------------------------

export type GastoDoDia = { dia: string; gasto: number };

export type ResultadoGastoDiario = {
  porDia: GastoDoDia[];
  cacheDe: string | null;
  aviso: string | null;
};

/** O `level` do nosso cache. Não é nível da Meta — ver a migration 0020. */
const NIVEL_DIARIO = 'diario';

async function lerCacheDiario(
  adAccountId: string,
  dateStart: string,
  dateStop: string,
): Promise<{ porDia: GastoDoDia[]; fetchedAt: string } | null> {
  try {
    const supabase = await criarClienteServidor();
    const { data } = await supabase
      .from('meta_insights_cache')
      .select('data, fetched_at')
      .eq('ad_account_id', adAccountId)
      .eq('level', NIVEL_DIARIO)
      .eq('date_start', dateStart)
      .eq('date_stop', dateStop)
      .maybeSingle();

    if (!data) return null;
    const fetchedAt = texto(data, 'fetched_at');
    if (!fetchedAt) return null;

    // Reconstruído campo a campo, como o outro cache: linha gravada por uma
    // versão anterior com outro nome viraria NaN na curva, sem avisar.
    const porDia = lista(data, 'data').flatMap((l): GastoDoDia[] => {
      const dia = texto(l, 'dia');
      return dia ? [{ dia, gasto: numero(l, 'gasto') ?? 0 }] : [];
    });

    return { porDia, fetchedAt };
  } catch {
    return null;
  }
}

async function gravarCacheDiario(
  adAccountId: string,
  dateStart: string,
  dateStop: string,
  porDia: GastoDoDia[],
): Promise<void> {
  try {
    await criarClienteAdmin().from('meta_insights_cache').upsert(
      {
        ad_account_id: adAccountId,
        level: NIVEL_DIARIO,
        date_start: dateStart,
        date_stop: dateStop,
        data: porDia,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'ad_account_id,level,date_start,date_stop' },
    );
  } catch (erro) {
    console.error(
      '[insights] não consegui gravar o cache diário:',
      erro instanceof Error ? erro.message : erro,
    );
  }
}

/**
 * O gasto da conta, dia a dia.
 *
 * Existe para o quadro de receita × investido da visão geral, onde as duas
 * séries dividem UM eixo. A receita sai do nosso banco com os dias vazios
 * inclusos; o gasto precisa vir no mesmo grão, senão a curva pula o dia sem
 * anúncio e mente sobre a forma.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ `time_increment=1` é o que muda o grão, e ele CUSTA.                    │
 * │                                                                         │
 * │ A Meta pontua por consulta, e o indicador que estoura primeiro numa     │
 * │ consulta pesada é o `total_cputime`, não a contagem de chamadas. Pedir  │
 * │ 36 meses dia a dia é a consulta mais cara que este painel faz.          │
 * │                                                                         │
 * │ Por isso ela passa pela MESMA fila serial por conta, pelo mesmo teto    │
 * │ de 25% e pelo mesmo cache de 15 min das outras — e `level=account`,     │
 * │ que é o grão mais barato que responde a pergunta. Quebrar por campanha  │
 * │ multiplicaria o custo para desenhar a mesma linha.                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export async function buscarGastoPorDia({
  contaId,
  adAccountId,
  de,
  ate,
  fuso,
}: {
  contaId: string;
  adAccountId: string;
  de: Date;
  ate: Date;
  fuso: string;
}): Promise<ResultadoGastoDiario> {
  // O `ate` do painel é exclusivo; o da Meta é inclusivo. Mesma conversão da
  // busca da árvore — sem ela o gasto não fecharia com a receita.
  const dataDe = comoData(de, fuso);
  const dataAte = comoData(new Date(ate.getTime() - 86_400_000), fuso);

  const doCache = await lerCacheDiario(adAccountId, dataDe, dataAte);
  if (doCache && Date.now() - Date.parse(doCache.fetchedAt) < TTL_CACHE_MS) {
    return { porDia: doCache.porDia, cacheDe: doCache.fetchedAt, aviso: null };
  }

  const token = await segredoDaContaDeAnuncio(contaId);
  if (!token) {
    return {
      porDia: doCache?.porDia ?? [],
      cacheDe: doCache?.fetchedAt ?? null,
      aviso: 'a conta de anúncio não tem token cadastrado',
    };
  }

  return emFila(adAccountId, async () => {
    const url = new URL(metaInsightsEndpoint(adAccountId));
    url.searchParams.set('level', 'account');
    url.searchParams.set('fields', 'spend');
    url.searchParams.set('time_increment', '1');
    url.searchParams.set(
      'time_range',
      JSON.stringify({ since: dataDe, until: dataAte }),
    );
    url.searchParams.set('limit', '500');

    try {
      const resposta = await fetch(url, {
        method: 'GET',
        // O token no CABEÇALHO, nunca na query — ele lê a conta inteira.
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      const uso = lerUso(resposta.headers.get('x-business-use-case-usage'));

      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        console.error(
          '[insights] a Meta recusou a série diária:',
          resposta.status,
          texto(corpo, 'error') ?? '',
        );
        return {
          porDia: doCache?.porDia ?? [],
          cacheDe: doCache?.fetchedAt ?? null,
          aviso:
            uso.bloqueadoPor > 0
              ? `a Meta bloqueou a conta por ${String(Math.ceil(uso.bloqueadoPor / 60))} min`
              : `a Meta recusou a consulta (${String(resposta.status)})`,
        };
      }

      const corpo: unknown = await resposta.json();
      /*
       * Com `time_increment=1` cada linha traz o `date_start` daquele dia —
       * é ele que vira a chave, nunca a posição na lista: a Meta omite o dia
       * sem gasto, e casar por índice deslocaria a curva inteira.
       */
      const porDia = lista(corpo, 'data').flatMap((l): GastoDoDia[] => {
        const dia = texto(l, 'date_start');
        if (!dia) return [];
        const gasto = Number(texto(l, 'spend') ?? '0');
        return [{ dia, gasto: Number.isFinite(gasto) ? gasto : 0 }];
      });

      await gravarCacheDiario(adAccountId, dataDe, dataAte, porDia);

      return {
        porDia,
        cacheDe: null,
        aviso: uso.acimaDoTeto
          ? `uso em ${String(Math.round(uso.percentual))}% da cota — o próximo pedido espera o cache (teto nosso: ${String(TETO_DE_USO)}%)`
          : null,
      };
    } catch (erro) {
      console.error(
        '[insights] falha na série diária:',
        erro instanceof Error ? erro.message : erro,
      );
      // Cache velho é melhor que quadro vazio.
      return {
        porDia: doCache?.porDia ?? [],
        cacheDe: doCache?.fetchedAt ?? null,
        aviso: 'não consegui falar com a Meta agora',
      };
    }
  });
}
