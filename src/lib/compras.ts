import 'server-only';

import { enviarParaTodosOsPixels, segredoDoGa4 } from '@/lib/destinos';
import { enviarParaGa4, montarPayloadGa4, type RespostaGa4 } from '@/lib/ga4/mp';
import { texto } from '@/lib/json';
import { montarPayload, montarUserData } from '@/lib/meta/capi';
import { hashEmail, hashNome, hashTelefone } from '@/lib/hash';
import { carregarConfiguracao } from '@/lib/settings';
import { criarClienteAdmin } from '@/lib/supabase/admin';

/**
 * A compra indo para a Meta e para o GA4.
 *
 * É o fecho do sistema: a venda que chegou pelo webhook, já casada com quem
 * a originou, volta para os destinos carregando a identidade do visitante —
 * `fbp`, `fbc` e os hashes. Sem isto, o otimizador da Meta nunca aprende
 * quais anúncios dão dinheiro, que é o problema inteiro que o projeto
 * existe para resolver.
 */

/** Só estes campos são lidos da linha; o resto não interessa ao envio. */
type LinhaCompra = Record<string, unknown>;

/**
 * O `event_id` da compra.
 *
 * Derivado do `transaction_id`, portanto estável: o gateway reenviando o
 * mesmo evento gera o MESMO id, e a Meta deduplica em vez de contar duas
 * vezes. É a mesma razão do `event_id` compartilhado entre Pixel e servidor.
 */
export function eventIdDaCompra(transactionId: string): string {
  return `compra.${transactionId.replaceAll(/[^\w.:-]/g, '-')}`;
}

/**
 * Dispara a compra, uma única vez.
 *
 * Roda em `after()` na rota do webhook — os 5 segundos são do gateway, não
 * nossos. Nada aqui lança: quem chamou já respondeu e não tem como tratar.
 */
export async function dispararCompra(transactionId: string): Promise<void> {
  const supabase = criarClienteAdmin();

  try {
    const { data } = await supabase
      .from('purchases')
      .select(
        'transaction_id, status, value, currency, email, email_hash, phone, phone_hash, ' +
          'first_name, last_name, product_id, product_name, fbp, fbc, ' +
          'ga_client_id, ga_session_id, geo_country, geo_region, geo_city, ip, sent_at',
      )
      .eq('transaction_id', transactionId)
      .returns<LinhaCompra[]>()
      .maybeSingle();

    if (!data) return;

    // Só venda aprovada vira conversão. Pendente ainda pode não acontecer, e
    // mandar antes da hora ensina a Meta a otimizar para gente que não paga.
    if (texto(data, 'status') !== 'aprovada') return;

    // A trava do reenvio: o gateway manda o mesmo evento várias vezes, e a
    // Appmax ainda tem retry próprio. `sent_at` é o "já mandei?".
    if (texto(data, 'sent_at')) return;

    const eventId = eventIdDaCompra(transactionId);
    const [respostaMeta, respostaGa4] = await Promise.all([
      enviarParaMeta(data, eventId),
      enviarParaGa4Mp(data, eventId),
    ]);

    await supabase
      .from('purchases')
      .update({
        meta_event_id: eventId,
        response_meta: respostaMeta,
        response_ga4: respostaGa4,
        // Marcado mesmo com falha em algum destino: reenviar sozinho
        // duplicaria a conversão. Quem falhou está no log, para reenvio
        // manual e deliberado.
        sent_at: new Date().toISOString(),
      })
      .eq('transaction_id', transactionId);
  } catch (erro) {
    console.error(
      '[compras] falha ao disparar:',
      erro instanceof Error ? erro.message : erro,
    );
  }
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

async function enviarParaMeta(compra: LinhaCompra, eventId: string): Promise<unknown> {
  const config = await carregarConfiguracao();
  if (config.pixels.length === 0) return { ignorado: 'nenhum pixel ativo' };

  const valor = compra.value;

  const payload = montarPayload(
    {
      event_name: 'Purchase',
      // Segundos, nunca milissegundos.
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      // A compra acontece noutro site, mas a Meta só aceita `website`,
      // `app` ou `physical_store` — e o funil é web.
      action_source: 'website',
      user_data: montarUserData({
        // Os hashes de e-mail e telefone já vêm prontos do banco; nome vem
        // em claro e é hasheado aqui pela MESMA função, então não há duas
        // normalizações para divergirem.
        emailHash: texto(compra, 'email_hash') ?? hashEmail(texto(compra, 'email')),
        phoneHash: texto(compra, 'phone_hash') ?? hashTelefone(texto(compra, 'phone')),
        firstNameHash: hashNome(texto(compra, 'first_name')),
        lastNameHash: hashNome(texto(compra, 'last_name')),
        // fbp e fbc vêm do VISITANTE, copiados no casamento. São o que mais
        // pesa no match, e nenhum gateway os conhece.
        fbp: texto(compra, 'fbp'),
        fbc: texto(compra, 'fbc'),
        ip: texto(compra, 'ip'),
      }),
      custom_data: {
        ...(typeof valor === 'number' ? { value: valor } : {}),
        currency: texto(compra, 'currency') ?? config.settings.currency,
        ...(texto(compra, 'product_id') ? { content_ids: [texto(compra, 'product_id')] } : {}),
        ...(texto(compra, 'product_name') ? { content_name: texto(compra, 'product_name') } : {}),
        content_type: 'product',
      },
    },
    config.settings.testEventCode,
  );

  return enviarParaTodosOsPixels(payload);
}

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------

/**
 * A compra no GA4, pelo Measurement Protocol.
 *
 * É o ÚNICO lugar onde o MP é usado. Os eventos do site já vão pela gtag.js,
 * e o MP não deduplica como a Meta — mandar os dois contaria duas vezes.
 * A compra é diferente: aconteceu noutro site e nunca passou por gtag.
 *
 * Sem `client_id` não dá para enviar: o GA4 exige, e inventar um faria a
 * compra abrir sessão nova e aparecer como tráfego direto — desligada do
 * anúncio que a trouxe, que é o oposto do que queremos.
 */
async function enviarParaGa4Mp(compra: LinhaCompra, eventId: string): Promise<unknown> {
  const config = await carregarConfiguracao();
  if (config.ga4.length === 0) return { ignorado: 'nenhuma propriedade ativa' };

  const clientId = texto(compra, 'ga_client_id');
  if (!clientId) {
    return { ignorado: 'a visita não tinha _ga; sem client_id o GA4 recusa' };
  }

  const valor = compra.value;
  const payload = montarPayloadGa4({
    clientId,
    sessionId: texto(compra, 'ga_session_id'),
    eventos: [
      {
        name: 'purchase',
        params: {
          // O GA4 deduplica compra por `transaction_id`.
          transaction_id: texto(compra, 'transaction_id') ?? eventId,
          ...(typeof valor === 'number' ? { value: valor } : {}),
          currency: texto(compra, 'currency') ?? config.settings.currency,
          ...(texto(compra, 'product_name')
            ? {
                items: [
                  {
                    item_id: texto(compra, 'product_id') ?? undefined,
                    item_name: texto(compra, 'product_name'),
                    price: typeof valor === 'number' ? valor : undefined,
                    quantity: 1,
                  },
                ],
              }
            : {}),
        },
      },
    ],
  });

  const envios = await Promise.allSettled(
    config.ga4.map(async (conta) => {
      const segredo = await segredoDoGa4(conta.id);
      if (!segredo) {
        return [
          conta.measurementId,
          { ok: false, status: 0, erro: 'propriedade sem api_secret' },
        ] as const;
      }
      return [
        conta.measurementId,
        await enviarParaGa4(conta.measurementId, segredo, payload),
      ] as const;
    }),
  );

  const respostas: Record<string, RespostaGa4> = {};
  for (const envio of envios) {
    if (envio.status === 'fulfilled') {
      const [id, resultado] = envio.value;
      respostas[id] = resultado;
    } else {
      console.error('[compras] envio ao GA4 rejeitado:', envio.reason);
    }
  }
  return respostas;
}
