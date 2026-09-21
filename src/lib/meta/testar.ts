import 'server-only';

import { objeto, texto } from '@/lib/json';
import { metaInsightsEndpoint, metaNodeEndpoint } from '@/lib/meta/constants';

export type ResultadoTeste = {
  ok: boolean;
  mensagem: string;
  detalhe?: string;
};


const TIMEOUT_MS = 10_000;

async function chamarMeta(url: string): Promise<{ status: number; corpo: unknown }> {
  const resposta = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Teste de conexão nunca pode vir de cache: a pergunta é "funciona AGORA?".
    cache: 'no-store',
  });
  return { status: resposta.status, corpo: await resposta.json().catch(() => null) };
}

function mensagemDeErro(corpo: unknown, padrao: string): string {
  // A Meta devolve o detalhe em `error.message` — quando devolve.
  return texto(objeto(corpo, 'error'), 'message') ?? padrao;
}

/**
 * Confere se o token da CAPI consegue ler o pixel.
 *
 * Lemos o nó do pixel em vez de enviar um evento de teste: verificar não
 * deveria sujar o Events Manager com eventos que ninguém pediu.
 */
export async function testarPixel(
  pixelId: string,
  capiToken: string,
): Promise<ResultadoTeste> {
  try {
    const url = new URL(metaNodeEndpoint(pixelId));
    url.searchParams.set('fields', 'id,name');
    url.searchParams.set('access_token', capiToken);

    const { status, corpo } = await chamarMeta(url.toString());

    if (status === 200) {
      const nome = texto(corpo, 'name');
      return {
        ok: true,
        mensagem: 'Conexão ok',
        detalhe: nome ? `Pixel "${nome}"` : `Pixel ${pixelId}`,
      };
    }

    return {
      ok: false,
      mensagem:
        status === 400 || status === 403
          ? 'O token não tem acesso a este pixel'
          : 'A Meta recusou a chamada',
      detalhe: mensagemDeErro(corpo, `HTTP ${status}`),
    };
  } catch (erro) {
    return {
      ok: false,
      mensagem: 'Não consegui falar com a Meta',
      detalhe: erro instanceof Error ? erro.message : 'erro desconhecido',
    };
  }
}

/** Confere se o token de Ads enxerga a conta de anúncio. */
export async function testarContaDeAnuncio(
  adAccountId: string,
  adsToken: string,
): Promise<ResultadoTeste> {
  try {
    // metaInsightsEndpoint já normaliza o prefixo act_; aqui queremos o nó.
    const base = metaInsightsEndpoint(adAccountId).replace(/\/insights$/, '');
    const url = new URL(base);
    url.searchParams.set('fields', 'name,currency,account_status');
    url.searchParams.set('access_token', adsToken);

    const { status, corpo } = await chamarMeta(url.toString());

    if (status === 200) {
      const detalhe = [texto(corpo, 'name'), texto(corpo, 'currency')]
        .filter(Boolean)
        .join(' · ');
      return { ok: true, mensagem: 'Conexão ok', detalhe: detalhe || undefined };
    }

    return {
      ok: false,
      mensagem:
        status === 400 || status === 403
          ? 'O token não tem acesso a esta conta de anúncio'
          : 'A Meta recusou a chamada',
      detalhe: mensagemDeErro(corpo, `HTTP ${status}`),
    };
  } catch (erro) {
    return {
      ok: false,
      mensagem: 'Não consegui falar com a Meta',
      detalhe: erro instanceof Error ? erro.message : 'erro desconhecido',
    };
  }
}
