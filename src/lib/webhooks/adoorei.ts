import { ehObjeto, lista, numero, texto } from '@/lib/json';
import { pareceYampi } from '@/lib/webhooks/envelope-yampi';
import type {
  Adaptador,
  CompraNormalizada,
  ProdutoComprado,
  StatusCompra,
} from '@/lib/webhooks/tipos';

/**
 * Adaptador da Adoorei.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ OS VALORES VÊM EM REAIS, não em centavos.                             │
 * │                                                                       │
 * │ `value_total: 110.00` é R$ 110,00. A Appmax e a Pagou mandam o        │
 * │ contrário (`25990` = R$ 259,90). Aplicar `deCentavos()` aqui daria    │
 * │ R$ 1,10 — erro de 100× que não quebra nada e só aparece semanas       │
 * │ depois, num ROAS absurdo.                                             │
 * │                                                                       │
 * │ É por isso que a conversão é decisão de CADA adaptador, e não uma     │
 * │ regra global.                                                         │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * A boa notícia: diferente da Appmax, o evento de pedido traz o cliente
 * completo — e-mail, telefone e nome já separado em `first_name`/`last_name`.
 * O plano B da atribuição funciona de verdade aqui.
 */

/**
 * Os oito status que a Adoorei documenta, exaustivamente.
 *
 * Como na Pagou e ao contrário da Appmax, a lista é publicada e fechada —
 * então a decisão é pelo `status`, não pelo evento. Os eventos
 * (`order.status.approved` etc.) são atalhos para o mesmo estado.
 */
const STATUS: Record<string, StatusCompra> = {
  approved: 'aprovada',

  pending: 'pendente',
  // Anti-fraude ainda avaliando: o dinheiro não é seu até sair de lá.
  in_analysis: 'pendente',

  refused: 'recusada',
  cancelled: 'recusada',
  failed: 'recusada',

  refunded: 'estornada',
  chargeback: 'chargeback',
};

function produtosDe(recurso: unknown): ProdutoComprado[] {
  // `items[]` do pedido traz referência, quantidade e preço — mas NÃO o nome.
  // (O nome só aparece no evento de carrinho abandonado.)
  return lista(recurso, 'items').map((item) => {
    const referencia = item !== null && typeof item === 'object' ? item : {};
    const id = texto(referencia, 'source_reference') ?? numero(referencia, 'source_reference');
    return {
      id: id === undefined ? null : String(id),
      nome: texto(referencia, 'name') ?? null,
      // Reais, como o resto.
      preco: numero(referencia, 'price') ?? null,
      quantidade: numero(referencia, 'quantity') ?? 1,
    };
  });
}

/** O vínculo com a visita, se o checkout tiver por onde devolvê-lo. */
function trckUserIdDe(recurso: unknown): string | null {
  // A Adoorei não documenta saco de metadados. `source_reference` é a
  // referência do pedido na origem (Shopify), e é o único campo livre que
  // pode carregar algo nosso.
  const candidatos = [
    texto(recurso, 'source_reference'),
    texto(recurso, 'gateway_transaction_id'),
  ];

  for (const bruto of candidatos) {
    if (!bruto) continue;
    const achado = /[0-9a-f]{32}/i.exec(bruto);
    if (achado) return achado[0].toLowerCase();
  }
  return null;
}

export const adoorei: Adaptador = {
  nome: 'adoorei',

  /**
   * O envelope da Adoorei é `{event, time, merchant, resource}`. O
   * `merchant.alias` é o que a distingue: nenhum outro gateway o tem.
   */
  reconhece(corpo: unknown): boolean {
    if (!ehObjeto(corpo)) return false;
    if (!ehObjeto(corpo.merchant) || !ehObjeto(corpo.resource)) return false;

    const evento = texto(corpo, 'event') ?? '';
    if (!evento.startsWith('order.') && !evento.startsWith('cart.')) return false;

    /*
     * A YAMPI USA O MESMO ENVELOPE. A recusa é explícita e nos dois sentidos
     * — depender da ORDEM do registro seria frágil, bastaria alguém
     * reordenar a lista para quebrar em silêncio. Ver `envelope-yampi.ts`.
     */
    return !pareceYampi(corpo);
  },

  normalizar(corpo: unknown): CompraNormalizada | null {
    if (!ehObjeto(corpo)) return null;

    const evento = texto(corpo, 'event');
    if (!evento) return null;

    // Carrinho abandonado não é venda. É sinal de remarketing, e entra
    // noutro lugar se um dia entrar.
    if (evento.startsWith('cart.')) return null;

    const recurso = ehObjeto(corpo.resource) ? corpo.resource : {};

    const bruto = texto(recurso, 'status');
    const status = bruto ? STATUS[bruto] : undefined;
    if (!status) {
      console.warn('[adoorei] status não mapeado:', bruto ?? '(ausente)');
      return null;
    }

    // `number` é o número do pedido na loja. Os cinco eventos de um pedido
    // trazem o mesmo — uma venda, uma linha.
    const numeroPedido = numero(recurso, 'number') ?? texto(recurso, 'number');
    if (numeroPedido === undefined) {
      console.warn('[adoorei] pedido sem number');
      return null;
    }

    const cliente = ehObjeto(recurso.customer) ? recurso.customer : {};

    return {
      plataforma: 'adoorei',
      transactionId: `adoorei:${String(numeroPedido)}`,
      evento,
      status,
      // EM REAIS. Sem conversão. Ver o aviso no topo do arquivo.
      valor: numero(recurso, 'value_total') ?? null,
      // A Adoorei não manda campo de moeda; opera em real.
      moeda: 'BRL',
      trckUserId: trckUserIdDe(recurso),
      email: texto(cliente, 'email') ?? null,
      telefone: texto(cliente, 'phone') ?? null,
      primeiroNome: texto(cliente, 'first_name') ?? null,
      sobrenome: texto(cliente, 'last_name') ?? null,
      // A Adoorei é a única das quatro que manda o IP do comprador.
      ipCliente: texto(cliente, 'ip') ?? null,
      produtos: produtosDe(recurso),
      ocorridoEm: texto(corpo, 'time') ?? null,
    };
  },
};
