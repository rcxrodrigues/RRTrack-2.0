import { ehObjeto, lista, numero, texto } from '@/lib/json';
import {
  deCentavos,
  type Adaptador,
  type CompraNormalizada,
  type ProdutoComprado,
  type StatusCompra,
} from '@/lib/webhooks/tipos';

/**
 * Adaptador da Zedy.
 *
 * Envelope PLANO: nada de `data`, `resource` ou embrulho — os campos ficam
 * no topo. Isso já a separa das outras quatro.
 *
 * Valores em CENTAVOS (`priceInCents`, `totalPriceInCents`), como a Appmax e
 * a Pagou, e ao contrário da Yampi e da Adoorei. A nomenclatura dela ajuda:
 * o sufixo `InCents` está no próprio nome do campo.
 */

/**
 * O status manda, não o evento — e é a própria doc que pede:
 *
 * > "A ordem de chegada dos eventos não é garantida. Use o `status` do
 * > payload como fonte de verdade, não a sequência."
 *
 * Os quatro valores são publicados numa enumeração fechada.
 */
const STATUS: Record<string, StatusCompra> = {
  paid: 'aprovada',
  waiting_payment: 'pendente',
  refused: 'recusada',
  refunded: 'estornada',
};

function produtosDe(corpo: unknown): ProdutoComprado[] {
  return lista(corpo, 'products').map((item) => {
    const id = numero(item, 'id') ?? texto(item, 'id');
    return {
      id: id === undefined ? null : String(id),
      nome: texto(item, 'name') ?? texto(item, 'planName') ?? null,
      // O nome do campo diz a unidade. Bom design da parte deles.
      preco: deCentavos(numero(item, 'priceInCents')),
      quantidade: numero(item, 'quantity') ?? 1,
    };
  });
}

/**
 * O vínculo com a visita.
 *
 * A Zedy manda `trackingParameters` com as cinco UTMs **e** dois campos
 * genéricos, `src` e `sck` — é neles que o `trck_user_id` cabe. São o
 * equivalente ao `informations` da Pagou e ao `metadata` da Yampi.
 */
function trckUserIdDe(corpo: unknown): string | null {
  const rastreio = ehObjeto(corpo) ? corpo.trackingParameters : undefined;

  const candidatos = [
    texto(rastreio, 'src'),
    texto(rastreio, 'sck'),
    // Último recurso: alguém pode ter posto o id na UTM de conteúdo.
    texto(rastreio, 'utm_content'),
  ];

  for (const bruto of candidatos) {
    if (!bruto) continue;
    const achado = /[0-9a-f]{32}/i.exec(bruto);
    if (achado) return achado[0].toLowerCase();
  }
  return null;
}

/** A Zedy manda o nome inteiro; a Meta quer separado. */
function separarNome(inteiro: string | undefined): [string | null, string | null] {
  const partes = (inteiro ?? '').trim().split(/\s+/).filter((p) => p.length > 0);
  if (partes.length === 0) return [null, null];
  return [partes[0] ?? null, partes.length > 1 ? partes.slice(1).join(' ') : null];
}

export const zedy: Adaptador = {
  nome: 'zedy',

  /**
   * `eventType` em MAIÚSCULAS com underscore e `orderId` no topo. Nenhuma
   * das outras quatro tem essa forma — a Appmax e a Pagou usam `event`
   * minúsculo, a Yampi e a Adoorei embrulham em `resource`.
   */
  reconhece(corpo: unknown): boolean {
    if (!ehObjeto(corpo)) return false;
    const evento = texto(corpo, 'eventType');
    return evento !== undefined && /^[A-Z_]+$/.test(evento) && texto(corpo, 'orderId') !== undefined;
  },

  normalizar(corpo: unknown): CompraNormalizada | null {
    if (!ehObjeto(corpo)) return null;

    const evento = texto(corpo, 'eventType');
    const orderId = texto(corpo, 'orderId');
    if (!evento || !orderId) return null;

    /*
     * Pedido de TESTE não vira conversão.
     *
     * A Zedy marca com `isTest`. Mandar um teste para a Meta como Purchase
     * ensina o otimizador a perseguir venda que não existe — e infla o
     * faturamento do painel. Fica guardado em `webhooks_recebidos`, então
     * nada se perde; só não conta.
     */
    if (corpo.isTest === true) {
      console.warn('[zedy] pedido de teste ignorado:', orderId);
      return null;
    }

    const bruto = texto(corpo, 'status');
    const status = bruto ? STATUS[bruto] : undefined;
    if (!status) {
      console.warn('[zedy] status não mapeado:', bruto ?? '(ausente)');
      return null;
    }

    const cliente = ehObjeto(corpo) ? corpo.customer : undefined;
    const [primeiroNome, sobrenome] = separarNome(texto(cliente, 'name'));

    // O total do pedido mora em `commission.totalPriceInCents`. O
    // `userCommissionInCents` é o líquido, depois da taxa — para ROAS o que
    // vale é o bruto, que é o que o cliente pagou.
    const comissao = ehObjeto(corpo) ? corpo.commission : undefined;

    return {
      plataforma: 'zedy',
      // `orderId` é o token do checkout, e a própria doc manda usá-lo como
      // chave de deduplicação.
      transactionId: `zedy:${orderId}`,
      evento,
      status,
      valor: deCentavos(numero(comissao, 'totalPriceInCents')),
      moeda: texto(corpo, 'currency') ?? 'BRL',
      trckUserId: trckUserIdDe(corpo),
      email: texto(cliente, 'email') ?? null,
      telefone: texto(cliente, 'phone') ?? null,
      primeiroNome,
      sobrenome,
      // A Zedy manda o IP do comprador, como a Adoorei.
      ipCliente: texto(cliente, 'ip') ?? null,
      produtos: produtosDe(corpo),
      ocorridoEm:
        texto(corpo, 'approvedDate') ?? texto(corpo, 'createdAt') ?? null,
    };
  },
};
