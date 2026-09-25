import { hashEmail, hashTelefone } from '@/lib/hash';
import { desfazerCompra, dispararCompra } from '@/lib/compras';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import type { LinhaGenerica } from '@/lib/supabase/tipos';
import { normalizarTrckUserId } from '@/lib/trck';
import {
  STATUS_QUE_DESFAZEM,
  SUBSTITUI,
  type CompraNormalizada,
} from '@/lib/webhooks/tipos';

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
  // Reversão é outro assunto: o valor dela não é o valor da venda.
  const desfaz = STATUS_QUE_DESFAZEM.includes(compra.status);

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
    /*
     * O valor da VENDA, e só dela.
     *
     * Num evento de reversão o valor vai para `reverted_value`, nunca para
     * cá: nenhum gateway documenta se o que manda ali é o total original ou
     * só o pedaço devolvido, e gravar sobre `value` faria uma venda de
     * R$ 200 com estorno de R$ 20 passar a valer R$ 20 no faturamento.
     */
    value: desfaz ? null : compra.valor,
    /** O que o evento de reversão trouxe. Vazio em qualquer outro evento. */
    reverted_value: desfaz ? compra.valor : null,
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
    /*
     * A identidade que o CHECKOUT capturou, quando ele captura (a Pagou
     * captura). O casamento passa por cima quando acha o visitante — o dele
     * é mais completo e tem os hashes. Quando não acha, isto é o que salva a
     * venda órfã de chegar à Meta sem nada.
     */
    fbp: compra.atribuicao?.fbp ?? null,
    fbc: compra.atribuicao?.fbc ?? null,
    utm_source: compra.atribuicao?.utmSource ?? null,
    utm_medium: compra.atribuicao?.utmMedium ?? null,
    utm_campaign: compra.atribuicao?.utmCampaign ?? null,
    utm_term: compra.atribuicao?.utmTerm ?? null,
    utm_content: compra.atribuicao?.utmContent ?? null,
    raw_webhook: cru,
    updated_at: new Date().toISOString(),
  };

  // Campo vazio não apaga o que já estava: o evento de estorno pode vir sem
  // os dados do cliente que o de aprovação trouxe.
  const paraGravar: LinhaGenerica = Object.fromEntries(
    Object.entries(registro).filter(([, v]) => v !== null && v !== undefined),
  );

  const supabase = criarClienteAdmin();

  /*
   * 1. Tenta criar. `ignoreDuplicates` com `.select()` é como se sabe se a
   *    linha é nova: o conflito devolve lista vazia.
   */
  const { data: criada, error: erroInsert } = await supabase
    .from('purchases')
    .upsert(paraGravar, { onConflict: 'transaction_id', ignoreDuplicates: true })
    .select('transaction_id');

  if (erroInsert) throw new Error(erroInsert.message);
  if ((criada ?? []).length > 0) return;

  /*
   * 2. Já existe. O status só entra se tiver AUTORIDADE para sobrescrever o
   *    que está lá — ver `SUBSTITUI`. O filtro vai no `where`, e não num
   *    `if` depois de ler, porque assim a decisão é atômica no Postgres:
   *    dois eventos do mesmo pedido chegando juntos não se atropelam.
   */
  const { data: avancou, error: erroUpdate } = await supabase
    .from('purchases')
    .update(paraGravar)
    .eq('transaction_id', compra.transactionId)
    .in('status', SUBSTITUI[compra.status])
    .select('transaction_id');

  if (erroUpdate) throw new Error(erroUpdate.message);
  if ((avancou ?? []).length > 0) return;

  /*
   * 3. O status não avança — mas o resto dos dados, sim.
   *
   * Um evento atrasado ainda pode trazer o cliente que o anterior não
   * trouxe. O que ele não pode é mexer no status: era assim que o reenvio
   * da aprovação ressuscitava uma venda estornada.
   */
  const semStatus: LinhaGenerica = Object.fromEntries(
    Object.entries(paraGravar).filter(([chave]) => chave !== 'status'),
  );

  const { error } = await supabase
    .from('purchases')
    .update(semStatus)
    .eq('transaction_id', compra.transactionId)
    .select('transaction_id');

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

      /*
       * O que o visitante NÃO tem não apaga o que o gateway trouxe.
       *
       * A Pagou devolve `fbp`/`fbc` capturados no checkout dela. Um
       * visitante casado por e-mail pode não ter `fbp` — escrever o nulo
       * dele por cima jogaria fora a única identificação que a venda tinha,
       * e a conversão iria para a Meta pior do que iria sem casar.
       *
       * O que SEMPRE escreve é o vínculo e o motivo: são a resposta do
       * casamento, e `null` ali seria "não respondi", não "não sei".
       */
      const doVisitante = Object.fromEntries(
        Object.entries({
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
        }).filter(([, v]) => v !== null && v !== undefined),
      );

      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase
        .from('purchases')
        .update({
          ...doVisitante,
          trck_user_id: data.trck_user_id,
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
