import { ehObjeto, lista, numero, texto } from '@/lib/json';
import {
  deCentavos,
  type Adaptador,
  type AtribuicaoDoGateway,
  type CompraNormalizada,
  type ProdutoComprado,
  type StatusCompra,
} from '@/lib/webhooks/tipos';

/**
 * Adaptador da Pagou.ai.
 *
 * Escrito a partir do OpenAPI v2 — ver `docs/gateways/pagou.md`.
 *
 * Diferença de desenho em relação à Appmax: o webhook publicado da Pagou é
 * MÍNIMO (`{id, event, data:{event_type, id, status, correlation_id}}`) — sem
 * comprador, sem valor, sem produtos. Este adaptador lê tudo que estiver
 * presente e não exige nada além do essencial: se o webhook real vier
 * completo, aproveitamos; se vier mínimo, a linha nasce com o que dá e o
 * enriquecimento fica para um `GET /v2/transactions/{id}`, que precisa de
 * chave de API.
 */

/**
 * Status da Pagou → o que significa para o faturamento.
 *
 * Aqui o `status` É confiável, ao contrário da Appmax: o OpenAPI publica a
 * enumeração fechada dos 17 valores.
 */
const STATUS: Record<string, StatusCompra> = {
  paid: 'aprovada',
  captured: 'aprovada',
  processed: 'aprovada',
  // Pago a menos que o cobrado, mas dinheiro entrou.
  partially_paid: 'aprovada',

  pending: 'pendente',
  processing: 'pendente',
  authorized: 'pendente',
  three_ds_required: 'pendente',

  refused: 'recusada',
  canceled: 'recusada',
  expired: 'recusada',

  refunded: 'estornada',
  partially_refunded: 'estornada',

  chargedback: 'chargeback',
  pre_chargedback: 'chargeback',
  in_protest: 'chargeback',
  // MED é o Mecanismo Especial de Devolução do Pix: devolução forçada pelo
  // banco por suspeita de fraude. É contestação, não estorno voluntário.
  med: 'chargeback',
};

/** O identificador da visita, no saco de chave/valor que a Pagou ecoa. */
function trckUserIdDe(dados: unknown, envelope: unknown): string | null {
  const candidatos: (string | undefined)[] = [];

  // `informations` é a forma documentada: array de {key, value}.
  for (const onde of [dados, envelope]) {
    for (const item of lista(onde, 'informations')) {
      const chave = texto(item, 'key')?.toLowerCase();
      if (chave === 'trck_user_id' || chave === 'trck' || chave === 'trck_id') {
        candidatos.push(texto(item, 'value'));
      }
    }
  }

  /*
   * `src` e `sck` do objeto `attribution`, e eles NÃO são redundância.
   *
   * A doc é explícita: `informations` "só aparece quando você enviou
   * entradas customizadas na criação; transações sem elas (ou criadas por
   * CHECKOUT LINKS) omitem o campo". Numa loja que manda o comprador para um
   * link de checkout — que é o caso da primeira oferta — a ponte documentada
   * simplesmente não volta. `src`/`sck` são parâmetros de URL, e atravessam.
   */
  const atribuicao = ehObjeto(dados) && ehObjeto(dados.attribution)
    ? dados.attribution
    : undefined;
  candidatos.push(texto(atribuicao, 'src'), texto(atribuicao, 'sck'));

  // `external_ref` e `correlation_id` são o mesmo valor com dois nomes: o
  // primeiro na criação, o segundo no webhook.
  candidatos.push(
    texto(dados, 'correlation_id'),
    texto(dados, 'external_ref'),
    texto(envelope, 'correlation_id'),
  );

  for (const bruto of candidatos) {
    if (!bruto) continue;
    const achado = /[0-9a-f]{32}/i.exec(bruto);
    if (achado) return achado[0].toLowerCase();
  }
  return null;
}

/**
 * O que o checkout da Pagou capturou por conta própria.
 *
 * Ela guarda `fbp`, `fbc` e as cinco UTMs em `data.attribution` — nenhum
 * outro dos cinco faz isso. Vale para a venda ÓRFÃ: sem casamento, a
 * conversão iria para a Meta sem identificação nenhuma; com isto vai ao
 * menos com o que o checkout viu.
 */
function atribuicaoDe(dados: unknown): AtribuicaoDoGateway | undefined {
  if (!ehObjeto(dados) || !ehObjeto(dados.attribution)) return undefined;
  const a = dados.attribution;

  const capturada: AtribuicaoDoGateway = {
    fbp: texto(a, 'fbp') ?? null,
    fbc: texto(a, 'fbc') ?? null,
    utmSource: texto(a, 'utm_source') ?? null,
    utmMedium: texto(a, 'utm_medium') ?? null,
    utmCampaign: texto(a, 'utm_campaign') ?? null,
    utmTerm: texto(a, 'utm_term') ?? null,
    utmContent: texto(a, 'utm_content') ?? null,
  };

  // Objeto presente e todo nulo não é atribuição: é ruído que só ocuparia
  // espaço na linha da compra.
  return Object.values(capturada).some((v) => v !== null) ? capturada : undefined;
}

function produtosDe(dados: unknown): ProdutoComprado[] {
  return lista(dados, 'products').map((item) => ({
    // `sku` na criação; a listagem devolve `title` em vez de `name`.
    id: texto(item, 'sku') ?? null,
    nome: texto(item, 'name') ?? texto(item, 'title') ?? null,
    preco: deCentavos(numero(item, 'price') ?? numero(item, 'unit_price')),
    quantidade: numero(item, 'quantity') ?? 1,
  }));
}

function compradorDe(dados: unknown): {
  email: string | null;
  telefone: string | null;
  primeiroNome: string | null;
  sobrenome: string | null;
} {
  /*
   * `customer` é o que o webhook REAL manda — confirmado nos dois exemplos
   * publicados (22/09/2026). `buyer` veio do OpenAPI da criação e continua
   * aceito, mas ler só ele perdia o comprador inteiro: sem e-mail, o plano B
   * do casamento nunca rodaria, e toda venda da Pagou chegaria órfã.
   */
  const comprador = ehObjeto(dados)
    ? (ehObjeto(dados.customer) ? dados.customer : ehObjeto(dados.buyer) ? dados.buyer : undefined)
    : undefined;

  // A Pagou manda o nome inteiro num campo só; a Meta quer separado.
  const inteiro = texto(comprador, 'name') ?? texto(dados, 'customer_name') ?? '';
  const partes = inteiro.trim().split(/\s+/).filter((p) => p.length > 0);

  return {
    email: texto(comprador, 'email') ?? texto(dados, 'customer_email') ?? null,
    telefone: texto(comprador, 'phone') ?? null,
    primeiroNome: partes[0] ?? null,
    sobrenome: partes.length > 1 ? partes.slice(1).join(' ') : null,
  };
}

export const pagou: Adaptador = {
  nome: 'pagou',

  /**
   * O envelope de pagamento da Pagou é `{id, event: "transaction", data}`.
   *
   * `event` no topo distingue pagamento de assinatura; transferência vem em
   * `type`, e é payout — dinheiro saindo, não venda.
   */
  reconhece(corpo: unknown): boolean {
    const evento = texto(corpo, 'event');
    return (
      texto(corpo, 'id') !== undefined &&
      (evento === 'transaction' || evento === 'subscription')
    );
  },

  normalizar(corpo: unknown): CompraNormalizada | null {
    if (!ehObjeto(corpo)) return null;

    // Assinatura é outro domínio: cada ciclo gera transação própria, que
    // chega também como transaction.*. Tratar os dois contaria duas vezes.
    if (texto(corpo, 'event') !== 'transaction') return null;

    const dados = ehObjeto(corpo.data) ? corpo.data : {};

    const transacaoId = texto(dados, 'id');
    if (!transacaoId) {
      console.warn('[pagou] evento sem id de transação');
      return null;
    }

    const bruto = texto(dados, 'status');
    const status = bruto ? STATUS[bruto] : undefined;
    if (!status) {
      console.warn('[pagou] status não mapeado:', bruto ?? '(ausente)');
      return null;
    }

    return {
      plataforma: 'pagou',
      transactionId: `pagou:${transacaoId}`,
      // `event_type` é o que descreve o que houve; `event` é só o roteamento.
      evento: texto(dados, 'event_type') ?? 'transaction',
      status,
      // `paid_amount` quando houver: é o que de fato entrou, e num
      // partially_paid ele difere do cobrado.
      valor: deCentavos(numero(dados, 'paid_amount') ?? numero(dados, 'amount')),
      moeda: texto(dados, 'currency') ?? 'BRL',
      trckUserId: trckUserIdDe(dados, corpo),
      ...compradorDe(dados),
      ipCliente: texto(dados, 'ip_address') ?? null,
      produtos: produtosDe(dados),
      ocorridoEm: texto(dados, 'paid_at') ?? texto(dados, 'created_at') ?? null,
      atribuicao: atribuicaoDe(dados),
    };
  },
};
