import { ehObjeto, numero, texto } from '@/lib/json';
import {
  indeciso,
  type Adaptador,
  type CompraNormalizada,
  type ContextoDoAdaptador,
  type Indeciso,
  type ProdutoComprado,
  type StatusCompra,
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
 * Os aliases que a Yampi traz DE FÁBRICA — e é só isso que eles são.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ Os aliases de status da Yampi são CONFIGURÁVEIS POR LOJA. Não existe │
 * │ lista fixa: o suporte confirmou (22/09/2026) que a única forma de     │
 * │ saber os da sua loja é chamar `GET /{alias}/checkout/statuses`.       │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Então este mapa é um ponto de partida, nunca a verdade. Quem manda é
 * `settings.status_aliases`, cadastrado no painel, que passa por cima daqui
 * — uma loja pode ter renomeado o estorno para `devolvido`, e nesse caso o
 * `refund` NUNCA chegaria ao GA4: a receita ficaria inflada por uma venda
 * que voltou para o cliente.
 *
 * Alias que não está em lugar nenhum não vira venda **nem desaparece**:
 * volta como `Indeciso`, com o alias no motivo, e aparece no painel para
 * ser cadastrado e reprocessado.
 */
const PADRAO_DE_FABRICA: Record<string, StatusCompra> = {
  waiting_payment: 'pendente',
  paid: 'aprovada',
  approved: 'aprovada',
  refunded: 'estornada',
  canceled: 'recusada',
  cancelled: 'recusada',
};

/**
 * O cadastro do painel vence o padrão de fábrica.
 *
 * Nessa ordem de propósito: quem cadastrou olhou a própria loja, e o padrão
 * daqui é só chute informado. Se a loja renomeou um status, o cadastro é a
 * única fonte que sabe disso.
 */
function statusDoAlias(
  alias: string | undefined,
  contexto: ContextoDoAdaptador | undefined,
): StatusCompra | undefined {
  if (!alias) return undefined;
  const chave = alias.toLowerCase();
  return contexto?.statusPorAlias[chave] ?? PADRAO_DE_FABRICA[chave];
}

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
 * O vínculo com a visita, no saco `metadata` — e só nele.
 *
 * CONFIRMADO pelo suporte da Yampi (22/09/2026): o único jeito de mandar
 * algo nosso é `?metadata[trck_user_id]=…`, **na URL do checkout** (na da
 * loja não vale), e ele volta em `resource.metadata.data[]` como
 * `{key, value}`. Não existe campo customizado dedicado, e as cinco UTMs
 * da Yampi são da vitrine, não do checkout.
 *
 * **O `cart_token` NÃO entra aqui.** Ele é o identificador do carrinho e
 * nunca carrega o nosso valor — mas é um hash, e um hash pode ter 32
 * hexadecimais seguidos. Aceitá-lo faria toda venda sem `metadata` nascer
 * com um `trck_user_id` inventado: não casaria com visitante nenhum, e a
 * linha ficaria com cara de atribuída sendo órfã. É a mesma armadilha do
 * `client_key: "merchant-key-123"` da Appmax, por outra porta.
 */
function trckUserIdDe(recurso: unknown): string | null {
  const meta = dados(recurso, 'metadata');

  for (const item of Array.isArray(meta) ? meta : []) {
    const chave = texto(item, 'key')?.toLowerCase();
    if (chave !== 'trck_user_id' && chave !== 'trck' && chave !== 'trck_id') {
      continue;
    }
    const achado = /[0-9a-f]{32}/i.exec(texto(item, 'value') ?? '');
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

  normalizar(
    corpo: unknown,
    contexto?: ContextoDoAdaptador,
  ): CompraNormalizada | Indeciso | null {
    if (!ehObjeto(corpo)) return null;

    const evento = texto(corpo, 'event');
    if (!evento) return null;

    const recurso = ehObjeto(corpo.resource) ? corpo.resource : {};

    // Nota fiscal não mexe em dinheiro.
    if (evento.startsWith('order.invoice.')) return null;

    /*
     * O EVENTO decide quando ele mesmo já responde — e esses dois vêm da
     * lista documentada da Yampi, que é dela e não da loja. Só o que sobra
     * cai no alias, que é onde a configuração por loja morde.
     */
    const alias = texto(dados(recurso, 'status'), 'alias');
    const status: StatusCompra | undefined =
      evento === 'order.paid'
        ? 'aprovada'
        : evento === 'transaction.payment.refused'
          ? 'recusada'
          : statusDoAlias(alias, contexto);

    if (!status) {
      /*
       * Nem `null` nem chute. `null` diria "ignorei de propósito" e a venda
       * se esconderia atrás de um badge verde; chutar um status mandaria
       * conversão errada para a Meta. O motivo leva o alias porque é ele
       * que precisa ser cadastrado.
       */
      return indeciso(
        alias
          ? `alias de status "${alias}" não está mapeado (evento ${evento}). ` +
              'Cadastre em Configuração → Geral → Status do checkout.'
          : `evento ${evento} veio sem alias de status`,
      );
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
      // A Yampi não manda IP do comprador no payload de pedido.
      ipCliente: null,
      produtos: produtosDe(recurso),
      ocorridoEm: texto(corpo, 'time') ?? null,
    };
  },
};
