import { hashEmail, hashTelefone } from '@/lib/hash';
import { desfazerCompra, dispararCompra } from '@/lib/compras';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { normalizarTrckUserId } from '@/lib/trck';
import type { CompraNormalizada } from '@/lib/webhooks/tipos';

/**
 * O que acontece com uma venda depois que o adaptador a traduziu.
 *
 * Mora aqui, e não na rota, porque tem DOIS chamadores: o webhook que chega
 * do gateway e o reprocessamento pelo painel. Duplicar o caminho seria
 * garantir que um dia os dois divergem — e o dia em que isso acontecer, a
 * venda reprocessada vai para a Meta diferente da que chegou sozinha, sem
 * ninguém notar.
 *
 * A divisão em duas funções não é estética: `gravar` roda DENTRO da
 * requisição, porque falhar ali tem de virar 500 para o gateway reenviar.
 * `concluir` roda depois da resposta, porque o gateway não pode esperar.
 */

/**
 * Grava a venda, uma linha por PEDIDO.
 *
 * Os quatro eventos de um pedido de cartão trazem o mesmo `order_id`: o
 * upsert atualiza a mesma linha em vez de criar quatro. E como a ordem de
 * chegada não é garantida, o que vale é o último estado recebido.
 */
export async function gravarCompra(
  compra: CompraNormalizada,
  cru: unknown,
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
    /*
     * O IP do COMPRADOR, quando o gateway manda — nunca o da requisição.
     * A requisição vem do servidor do gateway, e gravar aquele IP marcaria
     * toda venda com o datacenter dele. O geo da compra vem do VISITANTE,
     * preenchido no casamento, que é onde existe o dado de verdade.
     */
    ip: compra.ipCliente,
    raw_webhook: cru,
    updated_at: new Date().toISOString(),
  };

  // Campo vazio não apaga o que já estava: o evento de estorno pode vir sem
  // os dados do cliente que o de aprovação trouxe.
  const paraGravar = Object.fromEntries(
    Object.entries(registro).filter(([, v]) => v !== null && v !== undefined),
  );

  const { error } = await criarClienteAdmin()
    .from('purchases')
    .upsert(paraGravar, { onConflict: 'transaction_id' });

  if (error) throw new Error(error.message);
}

/**
 * Casa a venda com o visitante e manda para os destinos.
 *
 * O casamento vem ANTES do disparo, e em série: é ele que copia o `fbp`, o
 * `fbc` e o `ga_client_id` do visitante para a linha da compra. Disparar
 * antes mandaria a conversão sem identificação nenhuma — a Meta aceitaria e
 * o match seria quase zero.
 *
 * Disparar e desfazer se excluem por dentro: cada um checa o status e sai
 * calado quando não é o seu caso. Chamar os dois é mais simples e mais
 * seguro que decidir aqui — e a ordem dos eventos do gateway não é
 * garantida, então o estorno pode chegar antes da aprovação.
 */
export async function concluirCompra(compra: CompraNormalizada): Promise<void> {
  await casarComVisitante(compra);
  await dispararCompra(compra.transactionId);
  await desfazerCompra(compra.transactionId);
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
        .select('trck_user_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbp, fbc, ga_client_id, ga_session_id, geo_country, geo_region, geo_city')
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
          // O geo REAL do comprador: o da visita, não o do gateway.
          geo_country: data.geo_country,
          geo_region: data.geo_region,
          geo_city: data.geo_city,
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
