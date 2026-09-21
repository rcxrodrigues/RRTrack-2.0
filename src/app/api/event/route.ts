import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  prepararCaptura,
  recusar,
  recusarPayload,
  responder,
  responderPreflight,
} from '@/lib/captura';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { COOKIE_TRCK, normalizarTrckUserId } from '@/lib/trck';

export const dynamic = 'force-dynamic';

const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const textoCurto = z.string().trim().max(512).optional();

/**
 * O `event_id` é a chave da deduplicação com o Pixel: o snippet gera um valor
 * e usa o MESMO no navegador e aqui. A Meta, recebendo os dois, entende que é
 * um evento só. Sem isso, toda conversão conta em dobro.
 */
const corpoSchema = z.object({
  event_name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w-]+$/, { error: 'nome de evento com caractere inesperado' }),
  event_id: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[\w.:-]+$/, { error: 'event_id com caractere inesperado' }),

  trck_user_id: z.string().trim().max(64).optional(),
  url: z.string().trim().max(2048).optional(),

  utm_source: textoCurto,
  utm_medium: textoCurto,
  utm_campaign: textoCurto,
  utm_term: textoCurto,
  utm_content: textoCurto,

  // Valor, moeda, produto — o que descreve a conversão.
  custom_data: z.record(z.string(), z.unknown()).optional(),
});

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return responderPreflight(request);
}

/**
 * Registra um evento do site.
 *
 * Nesta fase o evento é gravado e enriquecido com o visitante. O envio para a
 * Meta e o GA4 entra na Fase 4 — o payload e a resposta de cada destino têm
 * colunas próprias em `events_log` esperando por isso.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const preparo = await prepararCaptura(request, 'event');
  if (!preparo.ok) return preparo.resposta;

  const { origem, geo, cookies } = preparo.ctx;

  const analise = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!analise.success) {
    return recusarPayload(origem, 'event', analise.error);
  }
  const corpo = analise.data;

  const trckUserId =
    normalizarTrckUserId(corpo.trck_user_id) ??
    normalizarTrckUserId(cookies.get(COOKIE_TRCK));

  const supabase = criarClienteAdmin();

  // As UTMs do evento têm precedência; faltando, herdam do visitante — uma
  // compra disparada na página de obrigado não carrega as UTMs da entrada.
  let utms = {
    utm_source: corpo.utm_source ?? null,
    utm_medium: corpo.utm_medium ?? null,
    utm_campaign: corpo.utm_campaign ?? null,
    utm_term: corpo.utm_term ?? null,
    utm_content: corpo.utm_content ?? null,
  };

  if (trckUserId && !utms.utm_source) {
    const { data } = await supabase
      .from('visitors')
      .select('utm_source, utm_medium, utm_campaign, utm_term, utm_content')
      .eq('trck_user_id', trckUserId)
      .maybeSingle();

    if (data) {
      utms = {
        utm_source: texto(data.utm_source),
        utm_medium: texto(data.utm_medium),
        utm_campaign: texto(data.utm_campaign),
        utm_term: texto(data.utm_term),
        utm_content: texto(data.utm_content),
      };
    }
  }

  const registro = {
    event_id: corpo.event_id,
    event_name: corpo.event_name,
    trck_user_id: trckUserId,
    event_source_url: corpo.url ?? null,
    ...utms,
    ip: geo.ip,
    geo_country: geo.pais,
    geo_region: geo.regiao,
    geo_city: geo.cidade,
    // Guardado desde já: é o que a Fase 4 vai mandar em `custom_data`.
    payload_meta: corpo.custom_data ? { custom_data: corpo.custom_data } : null,
  };

  try {
    // ignoreDuplicates: o mesmo event_id chegando duas vezes é o próprio
    // mecanismo de dedup funcionando, não um erro para reportar.
    const { error } = await supabase
      .from('events_log')
      .upsert(registro, { onConflict: 'event_id', ignoreDuplicates: true });

    if (error) throw new Error(error.message);
  } catch (erro) {
    console.error(
      '[event] falha ao gravar:',
      erro instanceof Error ? erro.message : erro,
    );
    // 500 e não 200: o evento NÃO foi registrado, e quem chamou precisa
    // conseguir distinguir isso de um sucesso.
    return recusar(origem, 500, { erro: 'não foi possível registrar' });
  }

  return responder({ event_id: corpo.event_id, registrado: true }, origem);
}
