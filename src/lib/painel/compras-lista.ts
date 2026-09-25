import 'server-only';

import { numero as numeroEm, texto as textoEm } from '@/lib/json';
import { criarClienteServidor } from '@/lib/supabase/server';
import {
  ehStatusCompra,
  STATUS_COMPRA,
  type StatusCompra,
} from '@/lib/webhooks/tipos';

import type { Intervalo } from './periodo';

/** Quantas vendas por página na tabela de faturamento. */
export const COMPRAS_POR_PAGINA = 50;

export type LinhaCompraPainel = {
  id: string;
  transactionId: string;
  plataforma: string | null;
  status: StatusCompra;
  valor: number | null;
  /** O que voltou, quando o gateway informou. */
  devolvido: number | null;
  moeda: string;
  produto: string | null;
  email: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmMedium: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  /** Como a venda foi ligada ao visitante — `nenhum` quando ficou órfã. */
  matchMethod: string | null;
  /** Já saiu para os destinos? */
  enviada: boolean;
  /** Já foi desfeita nos destinos? */
  desfeita: boolean;
  criadaEm: string;
};

export type FiltroCompras = {
  /** Um dos cinco status, ou vazio para todos. */
  status: string;
  pagina: number;
};

const TETO_DE_PAGINA = 1_000_000;

function um(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

export function lerFiltroCompras(
  params: Record<string, string | string[] | undefined>,
): FiltroCompras {
  const bruto = um(params.status).toLowerCase();
  const pagina = Number.parseInt(um(params.pagina), 10);

  return {
    /*
     * Status desconhecido vira "todos", não vai para a consulta.
     * `?status=' or 1=1` não chega perto do banco — mas mesmo um valor
     * inofensivo e inexistente devolveria lista vazia sem explicação, e
     * "não filtrei" é uma resposta melhor que "não achei nada".
     */
    status: (STATUS_COMPRA as readonly string[]).includes(bruto) ? bruto : '',
    pagina:
      Number.isFinite(pagina) && pagina > 0 ? Math.min(pagina, TETO_DE_PAGINA) : 0,
  };
}

const COLUNAS =
  'id, transaction_id, platform, status, value, reverted_value, currency, ' +
  'product_name, email, utm_source, utm_medium, utm_campaign, utm_term, ' +
  'utm_content, match_method, sent_at, reverted_at, created_at';

export async function buscarCompras(
  intervalo: Intervalo,
  filtro: FiltroCompras,
): Promise<{ linhas: LinhaCompraPainel[]; total: number }> {
  const supabase = await criarClienteServidor();

  let consulta = supabase
    .from('purchases')
    .select(COLUNAS, { count: 'exact' })
    .gte('created_at', intervalo.de.toISOString())
    .lt('created_at', intervalo.ate.toISOString());

  if (filtro.status) consulta = consulta.eq('status', filtro.status);

  const inicio = filtro.pagina * COMPRAS_POR_PAGINA;

  const { data, count, error } = await consulta
    .order('created_at', { ascending: false })
    .range(inicio, inicio + COMPRAS_POR_PAGINA - 1);

  if (error) {
    console.error('[painel] compras falhou:', error.message);
    return { linhas: [], total: 0 };
  }

  const linhas = (Array.isArray(data) ? data : []).flatMap((linha) => {
    const id = textoEm(linha, 'id');
    const transactionId = textoEm(linha, 'transaction_id');
    const status = textoEm(linha, 'status') ?? '';
    const criadaEm = textoEm(linha, 'created_at');

    /*
     * `ehStatusCompra` é guarda de tipo, não afirmação: o compilador estreita
     * sozinho. Um status que não seja um dos cinco não entra na lista —
     * ele não existiria sem alguém ter escrito direto no banco, e deixá-lo
     * passar espalharia um valor que o resto do painel não sabe tratar.
     */
    if (
      id === undefined ||
      transactionId === undefined ||
      criadaEm === undefined ||
      !ehStatusCompra(status)
    ) {
      return [];
    }

    return [
      {
        id,
        transactionId,
        plataforma: textoEm(linha, 'platform') ?? null,
        status,
        valor: numeroEm(linha, 'value') ?? null,
        devolvido: numeroEm(linha, 'reverted_value') ?? null,
        moeda: textoEm(linha, 'currency') ?? 'BRL',
        produto: textoEm(linha, 'product_name') ?? null,
        email: textoEm(linha, 'email') ?? null,
        utmSource: textoEm(linha, 'utm_source') ?? null,
        utmCampaign: textoEm(linha, 'utm_campaign') ?? null,
        utmMedium: textoEm(linha, 'utm_medium') ?? null,
        utmTerm: textoEm(linha, 'utm_term') ?? null,
        utmContent: textoEm(linha, 'utm_content') ?? null,
        matchMethod: textoEm(linha, 'match_method') ?? null,
        enviada: textoEm(linha, 'sent_at') !== undefined,
        desfeita: textoEm(linha, 'reverted_at') !== undefined,
        criadaEm,
      },
    ];
  });

  return { linhas, total: count ?? 0 };
}
