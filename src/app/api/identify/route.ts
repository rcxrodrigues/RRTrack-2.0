import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  opcoesCookieTrck,
  prepararCaptura,
  recusarPayload,
  responder,
  responderPreflight,
} from '@/lib/captura';
import {
  clientIdDoGa,
  lerFbp,
  lerOuMontarFbc,
  nomeCookieSessaoGa,
  sessionIdDoGa,
} from '@/lib/cookies-terceiros';
import {
  hashCidade,
  hashEmail,
  hashEstado,
  hashExternalId,
  hashNome,
  hashPais,
  hashTelefone,
} from '@/lib/hash';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { COOKIE_TRCK, gerarTrckUserId, normalizarTrckUserId } from '@/lib/trck';

/** Este endpoint grava; nunca deve ser pré-renderizado nem cacheado. */
export const dynamic = 'force-dynamic';

const textoCurto = z.string().trim().max(512).optional();

const corpoSchema = z.object({
  // O que o navegador acha que é o identificador. Confirmado no servidor.
  trck_user_id: z.string().trim().max(64).optional(),

  url: z.string().trim().max(2048).optional(),
  referrer: textoCurto,

  utm_source: textoCurto,
  utm_medium: textoCurto,
  utm_campaign: textoCurto,
  utm_term: textoCurto,
  utm_content: textoCurto,

  // O clique do anúncio, quando o Pixel ainda não rodou.
  fbclid: textoCurto,

  // Dados pessoais, quando o site já os conhece (área logada, checkout).
  email: z.string().trim().max(320).optional(),
  phone: textoCurto,
  first_name: textoCurto,
  last_name: textoCurto,
});

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return responderPreflight(request);
}

/**
 * Identifica o visitante e guarda o que se sabe dele.
 *
 * É chamado a cada pageview do site. A cada chamada o UPSERT enriquece a
 * linha: numa visita chega só a UTM, noutra o `_fbp` depois do Pixel carregar,
 * noutra o e-mail quando a pessoa preenche um formulário.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const preparo = await prepararCaptura(request, 'identify');
  if (!preparo.ok) return preparo.resposta;

  const { origem, config, geo, cookies, userAgent } = preparo.ctx;

  const analise = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!analise.success) {
    return recusarPayload(origem, 'identify', analise.error);
  }
  const corpo = analise.data;

  // Precedência do identificador: o que veio no corpo (que o snippet tirou da
  // URL ou do cookie), depois o cookie desta requisição, e só então um novo.
  // A URL vem primeiro porque é ela que carrega o vínculo de quem chegou por
  // um link de checkout ou de WhatsApp.
  const trckUserId =
    normalizarTrckUserId(corpo.trck_user_id) ??
    normalizarTrckUserId(cookies.get(COOKIE_TRCK)) ??
    gerarTrckUserId();

  // O session_id mora num cookie cujo nome depende do measurement id; com
  // várias propriedades GA4, o primeiro que responder serve.
  const gaSessionId =
    config.ga4
      .map((c) => sessionIdDoGa(cookies.get(nomeCookieSessaoGa(c.measurementId))))
      .find((s) => s !== null) ?? null;

  const registro = {
    trck_user_id: trckUserId,

    email: corpo.email ?? null,
    phone: corpo.phone ?? null,
    first_name: corpo.first_name ?? null,
    last_name: corpo.last_name ?? null,

    email_hash: hashEmail(corpo.email),
    phone_hash: hashTelefone(corpo.phone),
    first_name_hash: hashNome(corpo.first_name),
    last_name_hash: hashNome(corpo.last_name),
    city_hash: hashCidade(geo.cidade),
    state_hash: hashEstado(geo.regiao),
    country_hash: hashPais(geo.pais),
    external_id_hash: hashExternalId(trckUserId),

    fbp: lerFbp(cookies.get('_fbp')),
    fbc: lerOuMontarFbc(cookies.get('_fbc'), corpo.fbclid),
    ga_client_id: clientIdDoGa(cookies.get('_ga')),
    ga_session_id: gaSessionId,

    utm_source: corpo.utm_source ?? null,
    utm_medium: corpo.utm_medium ?? null,
    utm_campaign: corpo.utm_campaign ?? null,
    utm_term: corpo.utm_term ?? null,
    utm_content: corpo.utm_content ?? null,
    referrer: corpo.referrer ?? null,
    landing_url: corpo.url ?? null,

    ip: geo.ip,
    user_agent: userAgent,
    geo_country: geo.pais,
    geo_region: geo.regiao,
    geo_city: geo.cidade,

    pixel_id: config.pixels[0]?.pixelId ?? null,
    updated_at: new Date().toISOString(),
  };

  // Campo que chegou vazio não apaga o que já estava: numa visita o e-mail
  // vem, na seguinte não — e perder o dado da primeira seria pior que não
  // tê-lo capturado.
  const paraGravar = Object.fromEntries(
    Object.entries(registro).filter(([, v]) => v !== null),
  );

  try {
    const { error } = await criarClienteAdmin()
      .from('visitors')
      .upsert(paraGravar, { onConflict: 'trck_user_id' });

    if (error) throw new Error(error.message);
  } catch (erro) {
    console.error(
      '[identify] falha ao gravar:',
      erro instanceof Error ? erro.message : erro,
    );
    // Devolve o identificador mesmo assim: sem ele o site não consegue
    // pendurar o vínculo nos links, e aí a venda chegaria órfã. Perder a
    // linha é ruim; perder a atribuição da venda é pior.
    return responder({ trck_user_id: trckUserId, gravado: false }, origem);
  }

  const resposta = responder({ trck_user_id: trckUserId, gravado: true }, origem);
  resposta.cookies.set(
    COOKIE_TRCK,
    trckUserId,
    opcoesCookieTrck(config.settings.cookieDomain),
  );
  return resposta;
}
