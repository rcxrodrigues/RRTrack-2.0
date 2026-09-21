import 'server-only';

import { numero, objeto, texto } from '@/lib/json';
import { metaEventsEndpoint } from '@/lib/meta/constants';

/**
 * Conversions API da Meta — o envio pelo servidor.
 *
 * O mesmo evento sai por dois caminhos: o Pixel no navegador e este aqui.
 * O que impede a conversão de contar em dobro é o `event_id` ser IDÊNTICO
 * nos dois — a Meta recebe os dois, vê o mesmo id e entende que é um evento
 * só, ficando com o mais completo.
 *
 * Por que mandar pelo servidor se o Pixel já manda: o Pixel é bloqueado por
 * extensão de anúncio, some no Safari com ITP e não roda se o JS falhar. O
 * servidor sempre chega.
 */

const TIMEOUT_MS = 10_000;

/**
 * Os dados da pessoa, do jeito que a Meta espera.
 *
 * Os campos hasheados vão em ARRAY: é a forma documentada e a que os SDKs
 * oficiais enviam. Os quatro de baixo vão em CLARO — hashear qualquer um
 * deles o torna inútil, porque a Meta precisa do valor para cruzar com o
 * que ela mesma observou no navegador.
 */
export type UserDataCapi = {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  external_id?: string[];

  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
};

export type EventoCapi = {
  event_name: string;
  event_time: number;
  event_id: string;
  event_source_url?: string;
  action_source: 'website';
  user_data: UserDataCapi;
  custom_data?: Record<string, unknown>;
};

/** O que gravamos em `events_log.payload_meta` — sem o token, nunca. */
export type PayloadCapi = {
  data: EventoCapi[];
  test_event_code?: string;
};

export type RespostaCapi = {
  ok: boolean;
  status: number;
  /** Quantos eventos a Meta aceitou. Zero com ok=true é sinal de problema. */
  eventsReceived?: number;
  fbtraceId?: string;
  erro?: string;
};

/** As chaves hasheadas, que a Meta espera em array. */
type ChaveHash = 'em' | 'ph' | 'fn' | 'ln' | 'ct' | 'st' | 'country' | 'external_id';

/**
 * Monta o `user_data` a partir do que já está gravado no visitante.
 *
 * Os hashes vêm prontos do banco (ver `src/lib/hash.ts`): hashear na hora do
 * envio significaria normalizar em dois lugares, e a hora em que os dois
 * divergissem seria a hora em que o match cairia sem ninguém notar.
 */
export function montarUserData(dados: {
  emailHash?: string | null;
  phoneHash?: string | null;
  firstNameHash?: string | null;
  lastNameHash?: string | null;
  cityHash?: string | null;
  stateHash?: string | null;
  countryHash?: string | null;
  externalIdHash?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): UserDataCapi {
  // Montado por acréscimo, não por remoção: campo vazio nunca chega a
  // existir, então não há chave com `undefined` para a Meta reclamar.
  const user: UserDataCapi = {};

  const hasheados: [ChaveHash, string | null | undefined][] = [
    ['em', dados.emailHash],
    ['ph', dados.phoneHash],
    ['fn', dados.firstNameHash],
    ['ln', dados.lastNameHash],
    ['ct', dados.cityHash],
    ['st', dados.stateHash],
    ['country', dados.countryHash],
    ['external_id', dados.externalIdHash],
  ];

  for (const [chave, valor] of hasheados) {
    if (valor) user[chave] = [valor];
  }

  // Em claro, de propósito. Ver o comentário do tipo.
  if (dados.fbp) user.fbp = dados.fbp;
  if (dados.fbc) user.fbc = dados.fbc;
  if (dados.ip) user.client_ip_address = dados.ip;
  if (dados.userAgent) user.client_user_agent = dados.userAgent;

  return user;
}

export function montarPayload(
  evento: EventoCapi,
  testEventCode?: string | null,
): PayloadCapi {
  return {
    data: [evento],
    // Com o código de teste o evento aparece em Test Events e NÃO conta como
    // conversão. É por isso que ele mora numa configuração que dá para
    // esvaziar: esquecê-lo preenchido em produção zera o otimizador.
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

/**
 * Envia para UM pixel.
 *
 * O token vai no corpo, não na query: query string aparece em log de proxy e
 * em histórico de erro, e este token dá acesso de escrita ao pixel.
 */
export async function enviarParaPixel(
  pixelId: string,
  capiToken: string,
  payload: PayloadCapi,
): Promise<RespostaCapi> {
  try {
    const resposta = await fetch(metaEventsEndpoint(pixelId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
      body: JSON.stringify({ ...payload, access_token: capiToken }),
    });

    const corpo: unknown = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      return {
        ok: false,
        status: resposta.status,
        erro: texto(objeto(corpo, 'error'), 'message') ?? `HTTP ${resposta.status}`,
        fbtraceId: texto(corpo, 'fbtrace_id'),
      };
    }

    // 200 com zero eventos recebidos é recusa silenciosa — a Meta responde
    // ok e descarta. Tratar como sucesso esconderia o problema no log.
    const recebidos = numero(corpo, 'events_received');

    return {
      ok: recebidos !== 0,
      status: resposta.status,
      eventsReceived: recebidos,
      fbtraceId: texto(corpo, 'fbtrace_id'),
      ...(recebidos === 0 ? { erro: 'a Meta aceitou a chamada e descartou o evento' } : {}),
    };
  } catch (erro) {
    // Timeout e falha de rede caem aqui. Não é motivo para derrubar os
    // outros destinos nem a requisição do visitante.
    return {
      ok: false,
      status: 0,
      erro: erro instanceof Error ? erro.message : 'falha de rede',
    };
  }
}
