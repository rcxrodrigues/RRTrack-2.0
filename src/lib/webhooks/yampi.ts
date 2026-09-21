import { ehObjeto, numero, texto } from '@/lib/json';
import type {
  Adaptador,
  CompraNormalizada,
  ProdutoComprado,
  StatusCompra,
} from '@/lib/webhooks/tipos';

/**
 * Adaptador da Yampi.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ MESMO ENVELOPE DA ADOOREI: {event, time, merchant, resource}, com     │
 * │ eventos `order.*`. Os dois adaptadores colidiriam.                    │
 * │                                                                       │
 * │ O que separa: a Yampi embrulha TODA relação em `.data`                │
 * │ (`status.data`, `customer.data`, `items.data`) — é a assinatura do    │
 * │ serializador Fractal. Na Adoorei, `status` é string e `customer` é    │
 * │ objeto plano.                                                          │
 * │                                                                       │
 * │ `yampi.test.ts` prova a separação nos dois sentidos. Sem isso, um     │
 * │ pedido da Adoorei seria lido com as regras da Yampi, e vice-versa.    │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Valores em REAIS (`value_total: 199.90`), como a Adoorei e ao contrário
 * da Appmax e da Pagou. Nada de `deCentavos()` aqui.
 */

/**
 * Os `status.data.alias` que sabemos mapear.
 *
 * ATENÇÃO: a lista completa de aliases da Yampi NÃO foi confirmada — só
 * `waiting_payment` apareceu no payload recebido. Os demais vêm do evento
 * `order.paid`, que É documentado.
 *
 * Alias desconhecido NÃO vira venda: é avisado no log e a linha não nasce.
 * O payload fica inteiro em `webhooks_recebidos`, então nada se perde e dá
 * para reprocessar quando a lista chegar.
 */
const STATUS: Record<string, StatusCompra> = {
  waiting_payment: 'pendente',
  paid: 'aprovada',
  approved: 'aprovada',
  refunded: 'estornada',
  canceled: 'recusada',
  cancelled: 'recusada',
};

/** A Yampi devolve relação como `{ data: … }`. */
function dados(valor: unknown, chave: string): unknown {
  if (!ehObjeto(valor)) return undefined;
  const campo = valor[chave];
  return ehObjeto(campo) && 'data' in campo ? campo.data : campo;
}

function produtosDe(recurso: unknown): ProdutoComprado[] {
  const itens = dados(recurso, 'items');
  return (Array.isArray(itens) ? itens : []).map((item) => {
    const sku = dados(item, 'sku');
    const id = numero(item, 'sku_id') ?? numero(item, 'product_id');
    return {
      id: id === undefined ? null : String(id),
      nome: texto(sku, 'title') ?? texto(sku, 'name') ?? texto(item, 'name') ?? null,
      // Reais.
      preco: numero(item, 'price') ?? null,
      quantidade: numero(item, 'quantity') ?? 1,
    };
  });
}

/**
 * O vínculo com a visita, no saco `metadata`.
 *
 * A Yampi devolve `metadata: { data: [{key, value}] }` — o exemplo traz
 * `cart_id`. É o lugar natural para o `trck_user_id`, se o checkout
 * permitir gravar lá. Também olhamos `cart_token`, que às vezes carrega
 * o que veio na URL.
 */
function trckUserIdDe(recurso: unknown): string | null {
  const candidatos: (string | undefined)[] = [];

  const meta = dados(recurso, 'metadata');
  for (const item of Array.isArray(meta) ? meta : []) {
    const chave = texto(item, 'key')?.toLowerCase();
    if (chave === 'trck_user_id' || chave === 'trck' || chave === 'trck_id') {
      candidatos.push(texto(item, 'value'));
    }
  }
  candidatos.push(texto(recurso, 'cart_token'));

  for (const bruto of candidatos) {
    if (!bruto) continue;
    const achado = /[0-9a-f]{32}/i.exec(bruto);
    if (achado) return achado[0].toLowerCase();
  }
  return null;
}

/** A Yampi manda o nome inteiro; a Meta quer separado. */
function separarNome(inteiro: string | undefined): [string | null, string | null] {
  const partes = (inteiro ?? '').trim().split(/\s+/).filter((p) => p.length > 0);
  if (partes.length === 0) return [null, null];
  return [partes[0] ?? null, partes.length > 1 ? partes.slice(1).join(' ') : null];
}

export const yampi: Adaptador = {
  nome: 'yampi',

  reconhece(corpo: unknown): boolean {
    if (!ehObjeto(corpo)) return false;
    if (!ehObjeto(corpo.merchant) || !ehObjeto(corpo.resource)) return false;
    // `order.*` E `transaction.*`: a recusa de pagamento chega como
    // `transaction.payment.refused`, e exigir só `order.` a perderia.
    const evento = texto(corpo, 'event') ?? '';
    if (!evento.startsWith('order.') && !evento.startsWith('transaction.')) return false;

    // O embrulho `.data` é o que a distingue da Adoorei.
    const status = corpo.resource.status;
    return ehObjeto(status) && 'data' in status;
  },

  normalizar(corpo: unknown): CompraNormalizada | null {
    if (!ehObjeto(corpo)) return null;

    const evento = texto(corpo, 'event');
    if (!evento) return null;

    const recurso = ehObjeto(corpo.resource) ? corpo.resource : {};

    // Nota fiscal não mexe em dinheiro.
    if (evento.startsWith('order.invoice.')) return null;

    // Dois eventos não deixam dúvida e vêm da lista documentada.
    // O resto decide pelo alias do status.
    const alias = texto(dados(recurso, 'status'), 'alias');
    const status: StatusCompra | undefined =
      evento === 'order.paid'
        ? 'aprovada'
        : evento === 'transaction.payment.refused'
          ? 'recusada'
          : alias
            ? STATUS[alias]
            : undefined;

    if (!status) {
      console.warn('[yampi] status não mapeado:', alias ?? '(ausente)', 'evento:', evento);
      return null;
    }

    // `id` é o do pedido; `number` é o número mostrado ao cliente. O `id` é
    // o estável.
    const id = numero(recurso, 'id') ?? numero(recurso, 'number');
    if (id === undefined) {
      console.warn('[yampi] pedido sem id');
      return null;
    }

    const cliente = dados(recurso, 'customer');
    const [primeiroNome, sobrenome] = separarNome(texto(cliente, 'name'));

    return {
      plataforma: 'yampi',
      transactionId: `yampi:${id}`,
      evento,
      status,
      // EM REAIS, como a Adoorei.
      valor: numero(recurso, 'value_total') ?? null,
      moeda: 'BRL',
      trckUserId: trckUserIdDe(recurso),
      email: texto(cliente, 'email') ?? null,
      // `phone` na Yampi é objeto; o texto pode estar em `full_number`.
      telefone:
        texto(dados(cliente, 'phone'), 'full_number') ??
        texto(dados(cliente, 'phone'), 'number') ??
        texto(cliente, 'phone') ??
        null,
      primeiroNome,
      sobrenome,
      produtos: produtosDe(recurso),
      ocorridoEm: texto(corpo, 'time') ?? null,
    };
  },
};
