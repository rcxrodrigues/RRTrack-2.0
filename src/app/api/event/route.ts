import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  prepararCaptura,
  recusar,
  recusarPayload,
  responder,
  responderPreflight,
} from '@/lib/captura';
import { dispararEvento } from '@/lib/destinos';
import { montarUserData } from '@/lib/meta/capi';
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
 * O evento é gravado, enriquecido com o visitante e mandado para a Conversions
 * API de todos os pixels ativos — com o MESMO `event_id` que foi para o Pixel
 * no navegador, que é o que impede a conversão de contar em dobro.
 *
 * O disparo acontece em `after()`, DEPOIS da resposta: este endpoint é
 * chamado pelo navegador de quem está comprando, e segurar a página por uma
 * ida à Meta seria trocar velocidade de loja por conveniência nossa.
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

  // O visitante é buscado SEMPRE que há identificador, não só quando falta
  // UTM: é dele que saem os hashes e o fbp/fbc que dão à Conversions API
  // alguém para casar. Sem isso o evento chega à Meta sem identificação.
  const visitante = trckUserId ? await buscarVisitante(supabase, trckUserId) : null;

  // As UTMs do evento têm precedência; faltando, herdam do visitante — uma
  // compra disparada na página de obrigado não carrega as UTMs da entrada.
  const utms =
    corpo.utm_source || !visitante
      ? {
          utm_source: corpo.utm_source ?? null,
          utm_medium: corpo.utm_medium ?? null,
          utm_campaign: corpo.utm_campaign ?? null,
          utm_term: corpo.utm_term ?? null,
          utm_content: corpo.utm_content ?? null,
        }
      : {
          utm_source: texto(visitante.utm_source),
          utm_medium: texto(visitante.utm_medium),
          utm_campaign: texto(visitante.utm_campaign),
          utm_term: texto(visitante.utm_term),
          utm_content: texto(visitante.utm_content),
        };

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
  };

  let inedito = false;
  try {
    // ignoreDuplicates: o mesmo event_id chegando duas vezes é o próprio
    // mecanismo de dedup funcionando, não um erro para reportar.
    //
    // O `select` não é enfeite: com ignoreDuplicates o conflito devolve
    // LISTA VAZIA, e é assim que se sabe se a linha é nova. Sem essa
    // distinção, um beacon reenviado dispararia a Meta de novo e
    // sobrescreveria a resposta já gravada do envio original.
    const { data, error } = await supabase
      .from('events_log')
      .upsert(registro, { onConflict: 'event_id', ignoreDuplicates: true })
      .select('event_id');

    if (error) throw new Error(error.message);
    inedito = (data ?? []).length > 0;
  } catch (erro) {
    console.error(
      '[event] falha ao gravar:',
      erro instanceof Error ? erro.message : erro,
    );
    // 500 e não 200: o evento NÃO foi registrado, e quem chamou precisa
    // conseguir distinguir isso de um sucesso.
    return recusar(origem, 500, { erro: 'não foi possível registrar' });
  }

  if (inedito) {
    const paraMeta = {
      event_name: corpo.event_name,
      // Segundos, não milissegundos: a Meta recusa o evento com a unidade
      // errada, dizendo apenas que o horário está fora da janela.
      event_time: Math.floor(Date.now() / 1000),
      event_id: corpo.event_id,
      ...(corpo.url ? { event_source_url: corpo.url } : {}),
      action_source: 'website' as const,
      user_data: montarUserData({
        emailHash: texto(visitante?.email_hash),
        phoneHash: texto(visitante?.phone_hash),
        firstNameHash: texto(visitante?.first_name_hash),
        lastNameHash: texto(visitante?.last_name_hash),
        cityHash: texto(visitante?.city_hash),
        stateHash: texto(visitante?.state_hash),
        countryHash: texto(visitante?.country_hash),
        externalIdHash: texto(visitante?.external_id_hash),
        fbp: texto(visitante?.fbp),
        fbc: texto(visitante?.fbc),
        // IP e user agent vêm desta requisição, não do visitante: a Meta
        // quer os do evento, e a pessoa pode ter trocado de rede.
        ip: geo.ip,
        userAgent: preparo.ctx.userAgent,
      }),
      ...(corpo.custom_data ? { custom_data: corpo.custom_data } : {}),
    };

    // Depois da resposta. O visitante não espera a Meta.
    after(async () => {
      await dispararEvento(paraMeta);
    });
  }

  return responder({ event_id: corpo.event_id, registrado: true }, origem);
}

/** As colunas do visitante que a Conversions API usa para casar. */
async function buscarVisitante(
  supabase: ReturnType<typeof criarClienteAdmin>,
  trckUserId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from('visitors')
    .select(
      'utm_source, utm_medium, utm_campaign, utm_term, utm_content, ' +
        'email_hash, phone_hash, first_name_hash, last_name_hash, ' +
        'city_hash, state_hash, country_hash, external_id_hash, fbp, fbc',
    )
    .eq('trck_user_id', trckUserId)
    .returns<Record<string, unknown>[]>()
    .maybeSingle();

  return data ?? null;
}
