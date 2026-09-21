import { createHash, timingSafeEqual } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';

import { extrairGeo } from '@/lib/geo';
import { hashEmail, hashTelefone } from '@/lib/hash';
import { bucketPorIp, dentroDoLimite, LIMITE_WEBHOOK } from '@/lib/ratelimit';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { normalizarTrckUserId } from '@/lib/trck';
import { lerWebhook, type CompraNormalizada } from '@/lib/webhooks';

/** Este endpoint grava; nunca deve ser pré-renderizado nem cacheado. */
export const dynamic = 'force-dynamic';

/**
 * O webhook de compra.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ A Appmax dá 5 SEGUNDOS para responder 200. Estourou, ela reenvia — e  │
 * │ depois de 4 tentativas descarta em definitivo, sem avisar ninguém.    │
 * │                                                                       │
 * │ Por isso a rota responde ANTES de trabalhar. Casar a venda, enviar    │
 * │ para a Meta e para o GA4 acontece em `after()`. Fazer isso dentro da  │
 * │ requisição seria apostar a venda contra a latência da rede.           │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Autenticação: o token vai na URL. Não é preferência — a Appmax **não envia
 * header de assinatura nem token** (ver `docs/gateways/appmax.md`), e a URL é
 * o único lugar onde um segredo cabe.
 */

/** Resposta sem corpo útil: quem chama é robô, não navegador. */
function responder(status: number, corpo: Record<string, unknown>): NextResponse {
  return NextResponse.json(corpo, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Compara em tempo constante.
 *
 * Um `===` vaza o tamanho do prefixo correto pelo tempo de resposta, e com
 * requisições suficientes isso reconstrói o token caractere a caractere. O
 * SHA-256 antes serve para os buffers terem sempre o mesmo tamanho — o
 * `timingSafeEqual` lança se receber tamanhos diferentes, e essa exceção
 * seria, ela mesma, o vazamento.
 */
function tokenConfere(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const geo = extrairGeo(request.headers);

  if (!(await dentroDoLimite(bucketPorIp('webhook', geo.ip), LIMITE_WEBHOOK))) {
    return responder(429, { erro: 'muitas requisições' });
  }

  const supabase = criarClienteAdmin();

  // O token aceita os dois lugares porque nem todo painel de gateway deixa
  // pôr query string no campo de URL.
  const recebido =
    request.nextUrl.searchParams.get('token') ??
    request.headers.get('x-webhook-token') ??
    '';

  const { data: esperado } = await supabase.rpc('get_webhook_token');

  if (typeof esperado !== 'string' || esperado.length === 0) {
    console.error('[webhook] nenhum token gerado no painel — recusando tudo');
    return responder(401, { erro: 'nao autorizado' });
  }

  if (recebido.length === 0 || !tokenConfere(recebido, esperado)) {
    console.warn('[webhook] token inválido');
    return responder(401, { erro: 'nao autorizado' });
  }

  /*
   * Lido como TEXTO, não como JSON.
   *
   * Parece detalhe e não é: HMAC assina os bytes exatos que chegaram. Um
   * `request.json()` descarta o texto original, e reconstruí-lo com
   * `JSON.stringify` muda espaçamento e ordem de chaves — a assinatura
   * nunca mais bateria. A MillionsPay assina (HMAC-SHA256 por endpoint),
   * então o corpo cru precisa sobreviver até a verificação.
   */
  const corpoCru = await request.text().catch(() => '');
  let corpo: unknown = null;
  try {
    corpo = corpoCru.length > 0 ? JSON.parse(corpoCru) : null;
  } catch {
    console.warn('[webhook] corpo não é JSON válido');
    return responder(202, { recebido: true, tratado: false });
  }

  const leitura = lerWebhook(corpo);

  if (leitura.tipo === 'desconhecido') {
    // 202 e não 400: o gateway reenviaria 4 vezes um payload que nós não
    // sabemos ler, e as quatro falhariam igual. Fica registrado no log.
    console.warn('[webhook] formato não reconhecido por nenhum adaptador');
    return responder(202, { recebido: true, tratado: false });
  }

  if (leitura.tipo === 'ignorado') {
    return responder(200, { recebido: true, tratado: false });
  }

  const { compra } = leitura;

  try {
    await gravarCompra(supabase, compra, corpo, geo);
  } catch (erro) {
    console.error(
      '[webhook] falha ao gravar:',
      erro instanceof Error ? erro.message : erro,
    );
    // 500 DE PROPÓSITO: aqui o retry do gateway é exatamente o que queremos.
    // Responder 200 numa falha nossa perderia a venda para sempre.
    return responder(500, { erro: 'nao foi possivel registrar' });
  }

  // Depois da resposta — os 5 segundos são do gateway, não nossos.
  after(async () => {
    await casarComVisitante(compra);
  });

  return responder(200, { recebido: true, tratado: true });
}

/**
 * Grava a venda, uma linha por PEDIDO.
 *
 * Os quatro eventos de um pedido de cartão trazem o mesmo `order_id`: o
 * upsert atualiza a mesma linha em vez de criar quatro. E como a ordem de
 * chegada não é garantida, o que vale é o último estado recebido.
 */
async function gravarCompra(
  supabase: ReturnType<typeof criarClienteAdmin>,
  compra: CompraNormalizada,
  cru: unknown,
  geo: ReturnType<typeof extrairGeo>,
): Promise<void> {
  const registro = {
    transaction_id: compra.transactionId,
    trck_user_id: normalizarTrckUserId(compra.trckUserId),
    email: compra.email,
    email_hash: hashEmail(compra.email),
    phone: compra.telefone,
    phone_hash: hashTelefone(compra.telefone),
    first_name: compra.primeiroNome,
    last_name: compra.sobrenome,
    product_id: compra.produtos[0]?.id ?? null,
    product_name: compra.produtos[0]?.nome ?? null,
    value: compra.valor,
    currency: compra.moeda,
    status: compra.status,
    platform: compra.plataforma,
    geo_country: geo.pais,
    geo_region: geo.regiao,
    geo_city: geo.cidade,
    raw_webhook: cru,
    updated_at: new Date().toISOString(),
  };

  // Campo vazio não apaga o que já estava: o evento de estorno pode vir sem
  // os dados do cliente que o de aprovação trouxe.
  const paraGravar = Object.fromEntries(
    Object.entries(registro).filter(([, v]) => v !== null && v !== undefined),
  );

  const { error } = await supabase
    .from('purchases')
    .upsert(paraGravar, { onConflict: 'transaction_id' });

  if (error) throw new Error(error.message);
}

/**
 * Liga a venda a quem a originou.
 *
 * Ordem de preferência: `trck_user_id` (exato), e-mail, telefone. O motivo
 * fica gravado em `match_reason` porque, quando o ROAS parecer errado, a
 * primeira pergunta vai ser "como esta venda foi parar nesta campanha?".
 */
async function casarComVisitante(compra: CompraNormalizada): Promise<void> {
  const supabase = criarClienteAdmin();

  try {
    const trckUserId = normalizarTrckUserId(compra.trckUserId);
    const emailHash = hashEmail(compra.email);
    const phoneHash = hashTelefone(compra.telefone);

    const tentativas: { metodo: string; coluna: string; valor: string }[] = [];
    if (trckUserId) tentativas.push({ metodo: 'trck_user_id', coluna: 'trck_user_id', valor: trckUserId });
    if (emailHash) tentativas.push({ metodo: 'email', coluna: 'email_hash', valor: emailHash });
    if (phoneHash) tentativas.push({ metodo: 'phone', coluna: 'phone_hash', valor: phoneHash });

    for (const tentativa of tentativas) {
      // Em SÉRIE de propósito. É uma cascata: só se o identificador exato
      // falhar é que vale tentar por e-mail, e só então por telefone.
      // Em paralelo, consultaríamos as três sempre — e o preço disso seria
      // pagar consulta à toa na esmagadora maioria das vendas, que casam
      // logo na primeira.
      // eslint-disable-next-line no-await-in-loop
      const { data } = await supabase
        .from('visitors')
        .select('trck_user_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbp, fbc, ga_client_id, ga_session_id')
        .eq(tentativa.coluna, tentativa.valor)
        // Mais de um visitante pode ter o mesmo e-mail (dois aparelhos, duas
        // visitas). O mais recente é o que trouxe a venda.
        .order('created_at', { ascending: false })
        .limit(1)
        .returns<Record<string, unknown>[]>()
        .maybeSingle();

      if (!data) continue;

      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase
        .from('purchases')
        .update({
          trck_user_id: data.trck_user_id,
          utm_source: data.utm_source,
          utm_medium: data.utm_medium,
          utm_campaign: data.utm_campaign,
          utm_term: data.utm_term,
          utm_content: data.utm_content,
          fbp: data.fbp,
          fbc: data.fbc,
          ga_client_id: data.ga_client_id,
          ga_session_id: data.ga_session_id,
          match_method: tentativa.metodo,
          match_reason: `casou por ${tentativa.coluna}`,
        })
        .eq('transaction_id', compra.transactionId);

      if (error) throw new Error(error.message);
      return;
    }

    // Nenhuma tentativa funcionou: a venda fica, sem atribuição. Registrado
    // como 'nenhum' em vez de nulo — "não casou" é uma resposta, e o painel
    // precisa poder contar quantas vendas chegaram órfãs.
    await supabase
      .from('purchases')
      .update({
        match_method: 'nenhum',
        match_reason:
          tentativas.length === 0
            ? 'o webhook não trouxe identificador, e-mail nem telefone'
            : 'nenhum visitante bateu com os dados recebidos',
      })
      .eq('transaction_id', compra.transactionId);
  } catch (erro) {
    console.error(
      '[webhook] falha ao casar a venda:',
      erro instanceof Error ? erro.message : erro,
    );
  }
}
