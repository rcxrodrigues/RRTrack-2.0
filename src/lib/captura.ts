import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import type { ZodError } from 'zod';

import { cabecalhosCors, origemPermitida } from '@/lib/cors';
import { extrairGeo, type Geo } from '@/lib/geo';
import { lerCookies } from '@/lib/cookies-terceiros';
import { bucketPorIp, dentroDoLimite, LIMITE_CAPTURA } from '@/lib/ratelimit';
import { carregarConfiguracao, type Configuracao } from '@/lib/settings';

/**
 * O portão dos endpoints públicos de captura.
 *
 * Todo pedido passa por aqui antes de tocar no banco: origem na allowlist,
 * rate limit por IP, e só então a leitura dos dados da requisição. Centralizar
 * evita o modo de falha clássico — um endpoint novo nascer sem uma das
 * travas porque quem escreveu esqueceu de copiar.
 */

export type ContextoCaptura = {
  origem: string;
  config: Configuracao;
  geo: Geo;
  cookies: Map<string, string>;
  userAgent: string | null;
};

type Resultado =
  | { ok: true; ctx: ContextoCaptura }
  | { ok: false; resposta: NextResponse };

/** Resposta de erro já com os cabeçalhos de CORS, quando cabem. */
function erro(
  status: number,
  mensagem: string,
  origem: string | null,
): NextResponse {
  return NextResponse.json(
    { ok: false, erro: mensagem },
    {
      status,
      headers: {
        ...(origem ? cabecalhosCors(origem) : {}),
        // Resposta de captura nunca é cacheável: cada visita é única.
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function prepararCaptura(
  request: NextRequest,
  endpoint: string,
): Promise<Resultado> {
  const origem = request.headers.get('origin');
  const config = await carregarConfiguracao();

  // A checagem já garante que `origem` não é null, mas o compilador não tem
  // como saber disso a partir de uma função externa — daí a guarda dupla.
  if (origem === null || !origemPermitida(origem, config.settings.origensPermitidas)) {
    // Sem detalhar o motivo: a resposta não deve ajudar alguém a descobrir
    // quais origens estão cadastradas.
    return { ok: false, resposta: erro(403, 'origem não autorizada', null) };
  }

  const geo = extrairGeo(request.headers);

  if (!(await dentroDoLimite(bucketPorIp(endpoint, geo.ip), LIMITE_CAPTURA))) {
    return { ok: false, resposta: erro(429, 'muitas requisições', origem) };
  }

  return {
    ok: true,
    ctx: {
      origem,
      config,
      geo,
      cookies: lerCookies(request.headers.get('cookie')),
      userAgent: request.headers.get('user-agent'),
    },
  };
}

/** A resposta ao preflight do navegador. */
export async function responderPreflight(request: NextRequest): Promise<NextResponse> {
  const origem = request.headers.get('origin');
  const { settings } = await carregarConfiguracao();

  if (origem === null || !origemPermitida(origem, settings.origensPermitidas)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: cabecalhosCors(origem),
  });
}

/** Resposta de sucesso, com CORS e sem cache. */
export function responder(
  corpo: Record<string, unknown>,
  origem: string,
  extras: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { ok: true, ...corpo },
    {
      headers: {
        ...cabecalhosCors(origem),
        'Cache-Control': 'no-store',
        ...extras,
      },
    },
  );
}

/**
 * Resposta de recusa, com CORS e sem cache.
 *
 * Existe separada de `responder` de propósito: passar `{ erro }` para a de
 * sucesso devolvia `{"ok":true,"erro":…}` com status 200 — um corpo que se
 * contradiz e um status que mente. Quem chama de fora não tem como tratar.
 */
export function recusar(
  origem: string,
  status: number,
  corpo: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { ok: false, ...corpo },
    {
      status,
      headers: {
        ...cabecalhosCors(origem),
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * A recusa de um payload que não passou no Zod.
 *
 * Devolve o CAMPO que falhou, não a mensagem do Zod. O campo ajuda quem está
 * instalando o snippet; a mensagem do Zod descreve o nosso schema por dentro
 * e não é assunto de um endpoint público. O detalhe completo vai para o log.
 */
export function recusarPayload(
  origem: string,
  endpoint: string,
  falha: ZodError,
): NextResponse {
  const primeiro = falha.issues[0];
  const campo = primeiro?.path.join('.') || null;

  console.warn(`[${endpoint}] payload recusado:`, primeiro?.message ?? 'sem detalhe');

  return recusar(origem, 400, { erro: 'payload inválido', campo });
}

/**
 * Os atributos do cookie `_trck`.
 *
 * `Domain=.transforlar.com` é o que faz o mesmo cookie valer na landing page
 * e aqui — cookie de primeira parte, que o Safari não descarta. Sem domínio
 * configurado, o cookie fica só neste host e o cross-domain se perde.
 */
export function opcoesCookieTrck(cookieDomain: string | null): {
  domain?: string;
  path: string;
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
} {
  return {
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    // httpOnly false de propósito: o snippet no site precisa ler o valor
    // para pendurá-lo nos links de checkout e de WhatsApp.
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
  };
}
