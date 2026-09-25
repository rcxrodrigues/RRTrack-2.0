import 'server-only';

import { enviarParaPixel, montarPayload, type EventoCapi } from '@/lib/meta/capi';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { carregarConfiguracao } from '@/lib/settings';

/**
 * O disparo para os destinos server-side.
 *
 * Duas promessas que o resto do sistema depende:
 *
 * 1. **Vai para TODOS os destinos ativos.** Quem tem dois pixels recebe o
 *    evento nos dois.
 * 2. **Falha num destino não derruba os outros.** `allSettled`, nunca `all`:
 *    com `all`, um pixel com token vencido faria o evento sumir dos demais.
 *
 * E uma terceira, implícita: nada aqui lança para quem chamou. Este código
 * roda depois da resposta ao visitante (ver `after()` na rota) e uma exceção
 * aqui viraria ruído no log sem ninguém para tratá-la.
 */

export type ResultadoDestino = {
  ok: boolean;
  status: number;
  eventsReceived?: number;
  fbtraceId?: string;
  erro?: string;
};

/** Resposta de cada destino, indexada pelo id do pixel. */
export type RespostasDestinos = Record<string, ResultadoDestino>;

// ---------------------------------------------------------------------------
// Cache dos tokens
// ---------------------------------------------------------------------------

/**
 * Sem cache, cada evento de cada visitante viraria uma leitura do cofre por
 * pixel — e ler o cofre é uma função `security definer` no Postgres, não um
 * select barato.
 *
 * O token já vive na memória da instância durante o envio; o cache só estende
 * isso por um minuto. Em troca, o banco deixa de ser chamado a cada pageview.
 * Nunca é logado, nunca sai daqui, e some quando a instância morre.
 */
const TTL_TOKEN_MS = 60_000;

const cacheTokens = new Map<string, { valor: string | null; expiraEm: number }>();

async function tokenDoPixel(contaId: string): Promise<string | null> {
  return segredoDaConta('get_meta_pixel_secret', contaId);
}

/** O `api_secret` de uma propriedade GA4, com o mesmo cache. */
export async function segredoDoGa4(contaId: string): Promise<string | null> {
  return segredoDaConta('get_ga4_secret', contaId);
}

/** O token de leitura de uma conta de anúncio, com o mesmo cache. */
export async function segredoDaContaDeAnuncio(
  contaId: string,
): Promise<string | null> {
  return segredoDaConta('get_meta_ad_account_secret', contaId);
}

async function segredoDaConta(rpc: string, contaId: string): Promise<string | null> {
  const chave = `${rpc}:${contaId}`;
  const guardado = cacheTokens.get(chave);
  if (guardado && guardado.expiraEm > Date.now()) return guardado.valor;

  try {
    const { data, error } = await criarClienteAdmin().rpc(rpc, { p_id: contaId });
    if (error) throw new Error(error.message);

    const valor = typeof data === 'string' && data.length > 0 ? data : null;
    cacheTokens.set(chave, { valor, expiraEm: Date.now() + TTL_TOKEN_MS });
    return valor;
  } catch (erro) {
    console.error(
      `[destinos] não consegui ler o segredo (${rpc}):`,
      erro instanceof Error ? erro.message : erro,
    );
    // Sem cache negativo aqui: um erro de leitura não deve calar o pixel por
    // um minuto inteiro. A próxima chamada tenta de novo.
    return null;
  }
}

/** Esvazia o cache — chamado depois de salvar um token no painel. */
export function invalidarTokens(): void {
  cacheTokens.clear();
}

// ---------------------------------------------------------------------------
// Disparo
// ---------------------------------------------------------------------------

/**
 * Manda o evento para todos os pixels ativos e grava a resposta de cada um.
 *
 * O GA4 NÃO entra aqui de propósito: o que acontece no navegador já foi pela
 * gtag.js que o snippet carregou, e o Measurement Protocol não deduplica —
 * mandar de novo contaria o evento duas vezes no relatório. O MP fica para a
 * compra do webhook, que nunca passou por navegador nenhum.
 */
export async function dispararEvento(evento: EventoCapi): Promise<void> {
  const config = await carregarConfiguracao();
  if (config.pixels.length === 0) return;

  const payload = montarPayload(evento, config.settings.testEventCode);
  const respostas = await enviarParaTodosOsPixels(payload);

  await gravarResposta(evento.event_id, payload, respostas);
}

/**
 * O fan-out em si, sem saber onde a resposta vai ser guardada.
 *
 * Separado porque evento de site e compra de webhook mandam o MESMO payload
 * para os MESMOS pixels, e só divergem no destino da resposta — um grava em
 * `events_log`, o outro em `purchases`. Duplicar isto seria garantir que um
 * dia as duas cópias divergem.
 */
export async function enviarParaTodosOsPixels(
  payload: ReturnType<typeof montarPayload>,
): Promise<RespostasDestinos> {
  const config = await carregarConfiguracao();

  const envios = await Promise.allSettled(
    config.pixels.map(async (pixel) => {
      const token = await tokenDoPixel(pixel.id);
      if (!token) {
        return [
          pixel.pixelId,
          { ok: false, status: 0, erro: 'pixel sem token cadastrado' },
        ] as const;
      }
      return [pixel.pixelId, await enviarParaPixel(pixel.pixelId, token, payload)] as const;
    }),
  );

  const respostas: RespostasDestinos = {};
  for (const envio of envios) {
    if (envio.status === 'fulfilled') {
      const [pixelId, resultado] = envio.value;
      respostas[pixelId] = resultado;
    } else {
      // `enviarParaPixel` já captura tudo; chegar aqui é bug nosso, e o log
      // precisa deixar isso evidente em vez de parecer falha da Meta.
      console.error('[destinos] envio rejeitado inesperadamente:', envio.reason);
    }
  }

  return respostas;
}

/**
 * Guarda o payload e a resposta no log do evento.
 *
 * O payload gravado é o que foi enviado — sem o token, que entra só na hora
 * do POST e nunca encosta nesta linha.
 */
async function gravarResposta(
  eventId: string,
  payload: unknown,
  respostas: RespostasDestinos,
): Promise<void> {
  try {
    const { error } = await criarClienteAdmin()
      .from('events_log')
      .update({ payload_meta: payload, response_meta: respostas })
      .eq('event_id', eventId);
    if (error) throw new Error(error.message);
  } catch (erro) {
    console.error(
      '[destinos] não consegui gravar a resposta:',
      erro instanceof Error ? erro.message : erro,
    );
  }
}
