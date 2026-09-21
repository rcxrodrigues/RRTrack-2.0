import 'server-only';

import { GA4_MP_ENDPOINT } from '@/lib/ga4/constants';

/**
 * Measurement Protocol do GA4 — o envio pelo servidor.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ ATENÇÃO AO ESCOPO. Isto NÃO é para os eventos do site.                │
 * │                                                                       │
 * │ O que acontece no navegador já vai pela gtag.js que o snippet carrega.│
 * │ Mandar o mesmo evento também por aqui CONTA DUAS VEZES no relatório — │
 * │ o GA4 não deduplica como a Meta faz com o event_id.                   │
 * │                                                                       │
 * │ Este módulo existe para a COMPRA que chega pelo webhook, que acontece │
 * │ noutro site e por isso nunca passou por gtag nenhuma.                 │
 * └───────────────────────────────────────────────────────────────────────┘
 */

const TIMEOUT_MS = 10_000;

export type EventoGa4 = {
  name: string;
  params: Record<string, unknown>;
};

/** O corpo do Measurement Protocol, como o GA4 o espera. */
export type PayloadGa4 = {
  client_id: string;
  timestamp_micros?: number;
  events: { name: string; params: Record<string, unknown> }[];
};

export type RespostaGa4 = {
  ok: boolean;
  status: number;
  erro?: string;
};

/**
 * Monta o corpo do Measurement Protocol.
 *
 * `client_id` e `session_id` são reaproveitados da VISITA (cookies `_ga` e
 * `_ga_<container>`, capturados no identify). Sem eles o GA4 abre uma sessão
 * nova e a compra aparece como tráfego direto, desligada do anúncio que a
 * trouxe — que é exatamente o que este projeto existe para evitar.
 */
export function montarPayloadGa4(opcoes: {
  clientId: string;
  sessionId?: string | null;
  eventos: EventoGa4[];
  /** Segundos desde a época. O GA4 recusa evento com mais de 72 horas. */
  timestampMicros?: number;
}): PayloadGa4 {
  return {
    client_id: opcoes.clientId,
    ...(opcoes.timestampMicros ? { timestamp_micros: opcoes.timestampMicros } : {}),
    events: opcoes.eventos.map((e) => ({
      name: e.name,
      params: {
        ...e.params,
        // Sem session_id o evento não entra na sessão da visita.
        ...(opcoes.sessionId ? { session_id: opcoes.sessionId } : {}),
        // O GA4 descarta como "não engajado" quem não manda isto.
        engagement_time_msec: '1',
      },
    })),
  };
}

export async function enviarParaGa4(
  measurementId: string,
  apiSecret: string,
  payload: PayloadGa4,
): Promise<RespostaGa4> {
  try {
    const url = new URL(GA4_MP_ENDPOINT);
    url.searchParams.set('measurement_id', measurementId);
    url.searchParams.set('api_secret', apiSecret);

    const resposta = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });

    // O MP responde 204 sem corpo para QUASE TUDO, inclusive para payload
    // ruim e credencial errada. Um 2xx aqui significa "a chamada chegou",
    // não "o evento foi aceito" — quem diz isso é o /debug/mp/collect, que
    // o "Testar conexão" usa.
    return resposta.ok
      ? { ok: true, status: resposta.status }
      : { ok: false, status: resposta.status, erro: `HTTP ${resposta.status}` };
  } catch (erro) {
    return {
      ok: false,
      status: 0,
      erro: erro instanceof Error ? erro.message : 'falha de rede',
    };
  }
}
