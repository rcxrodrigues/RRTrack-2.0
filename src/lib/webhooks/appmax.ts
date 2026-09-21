import { ehObjeto, lista, numero, texto } from '@/lib/json';
import {
  deCentavos,
  type Adaptador,
  type CompraNormalizada,
  type ProdutoComprado,
  type StatusCompra,
} from '@/lib/webhooks/tipos';

/**
 * Adaptador da Appmax.
 *
 * Escrito a partir da documentação de Webhooks da Appstore — ver
 * `docs/gateways/appmax.md`, que registra as três armadilhas conhecidas.
 * A mais importante: a Appmax tem DOIS formatos de webhook (Appstore e
 * Painel) e nós, como merchant, provavelmente recebemos o do Painel, cujo
 * formato a doc não detalha. Por isso o `reconhece` abaixo não exige `app_id`.
 */

/**
 * O mapa de evento → significado.
 *
 * A decisão é pelo EVENTO, não pelo campo `status`: a Appmax documenta os 40
 * eventos exaustivamente e não publica a lista de status — nos exemplos
 * aparecem só `aprovado` e `aguardando_pagamento`. Decidir por um campo cuja
 * lista de valores ninguém conhece é escolher ser surpreendido.
 */
const EVENTOS: Record<string, StatusCompra> = {
  // Dinheiro confirmado.
  order_approved: 'aprovada',
  order_paid: 'aprovada',
  order_paid_by_pix: 'aprovada',
  order_up_sold: 'aprovada',
  // Chargeback julgado a favor do lojista: o dinheiro fica.
  order_charge_back_gain: 'aprovada',

  // Esperando o cliente pagar.
  order_authorized: 'pendente',
  order_authorized_with_delay: 'pendente',
  payment_authorized_with_delay: 'pendente',
  order_pix_created: 'pendente',
  order_billet_created: 'pendente',
  order_pending_integration: 'pendente',

  // Não vai acontecer.
  order_refused_by_risk: 'recusada',
  payment_not_authorized: 'recusada',
  order_pix_expired: 'recusada',
  order_billet_overdue: 'recusada',

  // Desfaz receita já contada.
  order_refund: 'estornada',
  order_partial_refund: 'estornada',
  order_chargeback_in_treatment: 'chargeback',
};

/**
 * Os eventos que existem e NÃO interessam ao faturamento.
 *
 * Listados de propósito, em vez de caírem num `else` silencioso: assim um
 * evento novo da Appmax aparece como desconhecido no log, em vez de ser
 * descartado sem ninguém saber.
 */
const IGNORADOS = new Set([
  'order_integrated',
  'split_orders',
  'customer_created',
  'customer_interested',
  'customer_contacted',
]);

/** O identificador da visita, que o checkout devolve numa das chaves livres. */
function trckUserIdDe(envelope: Record<string, unknown>, dados: unknown): string | null {
  // Aparece nas duas alturas e com dois nomes; vale a primeira que tiver algo.
  const candidatos = [
    texto(dados, 'external_key'),
    texto(dados, 'client_key'),
    texto(envelope, 'external_key'),
    texto(envelope, 'client_key'),
  ];

  for (const bruto of candidatos) {
    if (!bruto) continue;
    // O checkout pode devolver o valor cru ou dentro de um texto maior.
    const achado = /[0-9a-f]{32}/i.exec(bruto);
    if (achado) return achado[0].toLowerCase();
  }
  return null;
}

function produtosDe(dados: unknown): ProdutoComprado[] {
  return lista(dados, 'products').map((item) => ({
    id: texto(item, 'sku') ?? null,
    nome: texto(item, 'name') ?? null,
    // Em evento de PEDIDO o preço vem em centavos. (Em evento de assinatura
    // a mesma chave vem em reais — ver docs/gateways/appmax.md. Aqui só
    // tratamos pedido, então centavos.)
    preco: deCentavos(numero(item, 'price')),
    quantidade: numero(item, 'quantity') ?? 1,
  }));
}

/**
 * O cliente, quando vier.
 *
 * Nos eventos `order_*` documentados **não vem nada disso** — nem e-mail, nem
 * telefone, nem `customer_id`. Lemos assim mesmo porque o formato do Painel
 * (que é o que devemos receber) não está documentado e pode trazer: se
 * trouxer, aproveitamos; se não, ficam nulos e o vínculo depende da chave
 * livre.
 */
function clienteDe(dados: unknown): {
  email: string | null;
  telefone: string | null;
  primeiroNome: string | null;
  sobrenome: string | null;
} {
  const cliente = ehObjeto(dados) && ehObjeto(dados.customer_data)
    ? dados.customer_data
    : dados;

  return {
    email: texto(cliente, 'email') ?? null,
    telefone: texto(cliente, 'telephone') ?? texto(cliente, 'phone') ?? null,
    primeiroNome: texto(cliente, 'firstname') ?? texto(cliente, 'first_name') ?? null,
    sobrenome: texto(cliente, 'lastname') ?? texto(cliente, 'last_name') ?? null,
  };
}

export const appmax: Adaptador = {
  nome: 'appmax',

  /**
   * O envelope da Appmax é `{ event, event_type, data }` com `event_type` em
   * quatro valores fechados. Não exigimos `app_id` nem `site_id`: eles são do
   * formato da Appstore, e o formato do Painel não os tem.
   */
  reconhece(corpo: unknown): boolean {
    const tipo = texto(corpo, 'event_type');
    return (
      texto(corpo, 'event') !== undefined &&
      (tipo === 'order' ||
        tipo === 'payment' ||
        tipo === 'customer' ||
        tipo === 'subscription')
    );
  },

  normalizar(corpo: unknown): CompraNormalizada | null {
    if (!ehObjeto(corpo)) return null;

    const evento = texto(corpo, 'event');
    if (!evento) return null;

    // Assinatura é outro domínio: um ciclo de cobrança gera pedido próprio e
    // chega também como order_*. Tratar os dois contaria a mesma receita duas
    // vezes.
    if (IGNORADOS.has(evento) || texto(corpo, 'event_type') === 'subscription') {
      return null;
    }

    const status = EVENTOS[evento];
    if (!status) {
      // Evento novo ou desconhecido: registrado no log, não engolido.
      console.warn('[appmax] evento não mapeado:', evento);
      return null;
    }

    const dados = ehObjeto(corpo.data) ? corpo.data : {};

    // É o order_id que identifica a VENDA. Os quatro eventos de um pedido de
    // cartão trazem o mesmo número — uma venda, uma linha.
    const orderId = numero(dados, 'order_id');
    if (orderId === undefined) {
      console.warn('[appmax] evento sem order_id:', evento);
      return null;
    }

    // Em evento de pagamento o valor tem outro nome.
    const valor = deCentavos(numero(dados, 'total') ?? numero(dados, 'payment_total'));

    return {
      plataforma: 'appmax',
      transactionId: `appmax:${orderId}`,
      evento,
      status,
      valor,
      // A Appmax opera em real e não manda campo de moeda.
      moeda: 'BRL',
      trckUserId: trckUserIdDe(corpo, dados),
      ...clienteDe(dados),
      produtos: produtosDe(dados),
      ocorridoEm: texto(dados, 'paid_at') ?? texto(dados, 'created_at') ?? null,
    };
  },
};
