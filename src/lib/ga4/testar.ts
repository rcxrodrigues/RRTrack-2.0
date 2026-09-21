import 'server-only';

import { lista, texto } from '@/lib/json';
import { GA4_MP_DEBUG_ENDPOINT } from '@/lib/ga4/constants';
import type { ResultadoTeste } from '@/lib/meta/testar';

type QueixaGA4 = {
  fieldPath?: string;
  description?: string;
  validationCode?: string;
};

/** As queixas do endpoint de debug, lidas sem confiar no formato. */
function queixasDe(corpo: unknown): QueixaGA4[] {
  return lista(corpo, 'validationMessages').map((item) => ({
    fieldPath: texto(item, 'fieldPath'),
    description: texto(item, 'description'),
    validationCode: texto(item, 'validationCode'),
  }));
}

/**
 * Confere se o par (measurement_id, api_secret) é aceito pelo GA4.
 *
 * Usa o endpoint de DEBUG: ele valida o payload e responde o que está errado,
 * sem registrar nada. Testar uma credencial não deveria inflar o relatório
 * de ninguém com um evento falso.
 *
 * Detalhe traiçoeiro: o MP responde 204 para quase tudo, inclusive para
 * credencial errada. É por isso que o teste tem de ser no /debug — lá as
 * queixas vêm no corpo da resposta.
 */
export async function testarGa4(
  measurementId: string,
  apiSecret: string,
): Promise<ResultadoTeste> {
  try {
    const url = new URL(GA4_MP_DEBUG_ENDPOINT);
    url.searchParams.set('measurement_id', measurementId);
    url.searchParams.set('api_secret', apiSecret);

    const resposta = await fetch(url.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
      body: JSON.stringify({
        client_id: 'rrtrack.teste-de-conexao',
        events: [
          {
            name: 'rrtrack_teste_conexao',
            params: { engagement_time_msec: '1', debug_mode: 1 },
          },
        ],
      }),
    });

    if (!resposta.ok) {
      return {
        ok: false,
        mensagem: 'O Google recusou a chamada',
        detalhe: `HTTP ${resposta.status}`,
      };
    }

    const queixas = queixasDe(await resposta.json().catch(() => null));

    if (queixas.length === 0) {
      return { ok: true, mensagem: 'Conexão ok', detalhe: measurementId };
    }

    const primeira = queixas[0];
    const descricao = primeira?.description ?? 'payload recusado';

    // O GA4 não diz "api_secret inválido" com todas as letras; ele reclama
    // do measurement_id quando o par não confere.
    const credencialInvalida = queixas.some(
      (q) =>
        q.validationCode === 'VALUE_INVALID' &&
        (q.fieldPath === 'measurement_id' || q.fieldPath === 'api_secret'),
    );

    return {
      ok: false,
      mensagem: credencialInvalida
        ? 'Measurement ID ou API Secret não conferem'
        : 'O GA4 recusou o evento de teste',
      detalhe: descricao,
    };
  } catch (erro) {
    return {
      ok: false,
      mensagem: 'Não consegui falar com o Google',
      detalhe: erro instanceof Error ? erro.message : 'erro desconhecido',
    };
  }
}
