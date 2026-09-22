import { describe, expect, it } from 'vitest';

import { yampi } from './yampi';
import { ehIndeciso, soVenda } from './tipos';
import { adoorei } from './adoorei';
import { lerWebhook } from './index';

/** Normaliza e descarta o `Indeciso`: aqui só interessa se virou venda. */
const ler = (corpo: unknown) => soVenda(yampi.normalizar(corpo));

/** O payload da Yampi, como recebido. */
const PEDIDO = {
  event: 'order.paid',
  time: '2025-01-01 12:00:00',
  merchant: { id: 123, alias: 'lojaexemplo' },
  resource: {
    id: 1000001,
    merchant_id: 123,
    customer_id: 987654,
    status_id: 3,
    number: 123456789012,
    value_total: 199.9,
    value_products: 180,
    value_shipment: 19.9,
    value_discount: 10,
    cart_token: 'cart-token-exemplo',
    status: { data: { id: 3, alias: 'waiting_payment', name: 'Aguardando pagamento' } },
    customer: {
      data: { id: 987654, name: 'Cliente Exemplo', email: 'cliente@exemplo.com', cpf: '00000000000' },
    },
    items: { data: [{ id: 111, product_id: 5555, sku_id: 7777, price: 180, quantity: 1 }] },
    transactions: { data: [{ id: 9999, amount: 199.9, status: 'paid' }] },
    metadata: { data: [{ key: 'cart_id', value: '123456' }] },
  },
};

/** O mesmo envelope, mas da Adoorei — é aqui que os dois colidiriam. */
const DA_ADOOREI = {
  event: 'order.status.approved',
  time: '2022-04-13T19:58:04.000000Z',
  merchant: { id: '1', alias: 'lojateste' },
  resource: {
    status: 'approved',
    number: 2,
    value_total: 110.0,
    customer: { first_name: 'Nome', last_name: 'Sobrenome', email: 'nome@email.com' },
    items: [{ source_reference: 40085810839652, quantity: 1, price: 100.0 }],
  },
};

/*
 * O teste mais importante do arquivo. Yampi e Adoorei usam o MESMO envelope
 * — {event, time, merchant, resource} com eventos `order.*`. Se os dois
 * reivindicassem o mesmo payload, um pedido seria lido com as regras do
 * outro: valor no campo errado, status que não existe, cliente vazio.
 */
describe('Yampi × Adoorei — o envelope é idêntico', () => {
  it('a Yampi reconhece o dela e NÃO o da Adoorei', () => {
    expect(yampi.reconhece(PEDIDO)).toBe(true);
    expect(yampi.reconhece(DA_ADOOREI)).toBe(false);
  });

  it('a Adoorei reconhece o dela e NÃO o da Yampi', () => {
    expect(adoorei.reconhece(DA_ADOOREI)).toBe(true);
    expect(adoorei.reconhece(PEDIDO)).toBe(false);
  });

  it('o registro entrega cada um ao dono certo', () => {
    const daYampi = lerWebhook(PEDIDO);
    expect(daYampi.tipo === 'venda' && daYampi.adaptador).toBe('yampi');

    const daAdoorei = lerWebhook(DA_ADOOREI);
    expect(daAdoorei.tipo === 'venda' && daAdoorei.adaptador).toBe('adoorei');
  });
});

describe('normalizar', () => {
  const c = ler(PEDIDO);

  // Reais, como a Adoorei — e ao contrário da Appmax e da Pagou.
  it('valor em REAIS, sem conversão', () => {
    expect(c?.valor).toBe(199.9);
    expect(c?.produtos[0]?.preco).toBe(180);
  });

  it('identifica pelo id do pedido, não pelo número mostrado ao cliente', () => {
    expect(c?.transactionId).toBe('yampi:1000001');
  });

  it('desembrulha o cliente de dentro do .data', () => {
    expect(c?.email).toBe('cliente@exemplo.com');
    expect(c?.primeiroNome).toBe('Cliente');
    expect(c?.sobrenome).toBe('Exemplo');
  });

  it('desembrulha os itens', () => {
    expect(c?.produtos[0]?.id).toBe('7777');
    expect(c?.produtos[0]?.quantidade).toBe(1);
  });

  /* order.paid é evento documentado: vale mesmo com o status ainda atrasado. */
  it('order.paid é aprovada, mesmo com o alias ainda em waiting_payment', () => {
    expect(c?.status).toBe('aprovada');
  });
});

describe('os eventos da lista', () => {
  /*
   * `transaction.payment.refused` começa com `transaction.`, não `order.`.
   * Exigir o prefixo `order.` perderia a recusa de pagamento inteira.
   */
  it('reconhece e trata transaction.payment.refused', () => {
    const payload = { ...PEDIDO, event: 'transaction.payment.refused' };
    expect(yampi.reconhece(payload)).toBe(true);
    expect(ler(payload)?.status).toBe('recusada');
  });

  it('nota fiscal não é dinheiro', () => {
    for (const event of ['order.invoice.created', 'order.invoice.updated']) {
      expect(ler({ ...PEDIDO, event }), event).toBeNull();
    }
  });

  it('order.status.updated decide pelo alias', () => {
    const c = ler({
      ...PEDIDO,
      event: 'order.status.updated',
      resource: { ...PEDIDO.resource, status: { data: { alias: 'refunded' } } },
    });
    expect(c?.status).toBe('estornada');
  });

  it('alias desconhecido NÃO inventa uma venda', () => {
    expect(
      ler({
        ...PEDIDO,
        event: 'order.status.updated',
        resource: { ...PEDIDO.resource, status: { data: { alias: 'em_separacao' } } },
      }),
    ).toBeNull();
  });
});

/*
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Os aliases de status da Yampi são CONFIGURÁVEIS POR LOJA. O suporte     │
 * │ confirmou (22/09/2026) que não existe lista fixa: a da sua loja vem de  │
 * │ `GET /{alias}/checkout/statuses`.                                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Um mapa fixo no código está errado por desenho. O estrago é específico e
 * silencioso: uma loja que renomeou o estorno para `devolvido` teria o
 * `refund` NUNCA chegando ao GA4, e o faturamento ficaria inflado por uma
 * venda que voltou para o cliente.
 */
describe('o alias vem do cadastro, não do código', () => {
  function mudancaDeStatus(alias: string) {
    return {
      ...PEDIDO,
      event: 'order.status.updated',
      resource: { ...PEDIDO.resource, status: { data: { alias } } },
    };
  }

  it('lê um alias que só existe naquela loja', () => {
    const c = yampi.normalizar(mudancaDeStatus('devolvido'), {
      statusPorAlias: { devolvido: 'estornada' },
    });
    expect(soVenda(c)?.status).toBe('estornada');
  });

  it('o cadastro VENCE o padrão de fábrica', () => {
    // Quem cadastrou olhou a própria loja; o padrão daqui é chute informado.
    // Uma loja pode ter um `canceled` que significa outra coisa.
    const c = yampi.normalizar(mudancaDeStatus('canceled'), {
      statusPorAlias: { canceled: 'estornada' },
    });
    expect(soVenda(c)?.status).toBe('estornada');
  });

  it('sem cadastro, o padrão de fábrica ainda vale', () => {
    expect(soVenda(yampi.normalizar(mudancaDeStatus('refunded')))?.status).toBe(
      'estornada',
    );
  });

  it('é indiferente a maiúscula no alias', () => {
    const c = yampi.normalizar(mudancaDeStatus('Devolvido'), {
      statusPorAlias: { devolvido: 'estornada' },
    });
    expect(soVenda(c)?.status).toBe('estornada');
  });

  /*
   * A distinção que evita a perda silenciosa. `null` diria "ignorei de
   * propósito" — e a venda se esconderia atrás do mesmo badge verde da nota
   * fiscal. `Indeciso` leva o alias no motivo, que é o que precisa ser
   * cadastrado, e aparece no painel.
   */
  it('alias fora do cadastro volta INDECISO, com o alias no motivo', () => {
    const lido = yampi.normalizar(mudancaDeStatus('aguardando_retirada'), {
      statusPorAlias: { devolvido: 'estornada' },
    });

    expect(ehIndeciso(lido)).toBe(true);
    if (!ehIndeciso(lido)) return;
    expect(lido.motivo).toContain('aguardando_retirada');
    expect(lido.motivo).toContain('Status do checkout');
  });

  it('indeciso NÃO é a mesma coisa que ignorado', () => {
    // Nota fiscal é ignorada de propósito: volta null, e está certo.
    expect(yampi.normalizar({ ...PEDIDO, event: 'order.invoice.created' })).toBeNull();
    // Alias desconhecido não: volta indeciso.
    expect(ehIndeciso(yampi.normalizar(mudancaDeStatus('nunca_visto')))).toBe(true);
  });

  it('o EVENTO documentado ganha do cadastro — ele é da Yampi, não da loja', () => {
    // `order.paid` não depende de alias nenhum: se dependesse, uma loja com
    // status renomeado perderia a venda paga, que é o que mais importa.
    const c = yampi.normalizar(
      { ...PEDIDO, event: 'order.paid' },
      { statusPorAlias: { waiting_payment: 'recusada' } },
    );
    expect(soVenda(c)?.status).toBe('aprovada');
  });
});

describe('o vínculo com a visita', () => {
  const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

  it('acha no saco metadata', () => {
    const c = ler({
      ...PEDIDO,
      resource: { ...PEDIDO.resource, metadata: { data: [{ key: 'trck_user_id', value: ID }] } },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  it('NÃO confunde cart_id do exemplo com identificador de visita', () => {
    expect(ler(PEDIDO)?.trckUserId).toBeNull();
  });

  /*
   * O suporte da Yampi confirmou (22/09/2026) que o `cart_token` é só o
   * identificador do carrinho e nunca carrega valor nosso. Mas ele é um
   * hash, e hash tem hexadecimal de sobra: aceitá-lo faria TODA venda sem
   * metadata nascer com um vínculo inventado. Não casaria com visitante
   * nenhum, e a linha ficaria com cara de atribuída sendo órfã.
   */
  it('IGNORA o cart_token, mesmo quando ele parece um identificador', () => {
    const c = ler({
      ...PEDIDO,
      resource: { ...PEDIDO.resource, cart_token: ID, metadata: { data: [] } },
    });
    expect(c?.trckUserId).toBeNull();
  });

  it('só aceita o valor de uma chave nossa, não de qualquer chave', () => {
    // A Yampi devolve o saco inteiro: `cart_id` e o que mais o checkout
    // tiver posto lá. Ler o primeiro valor que pareça um hash ligaria a
    // venda a um fantasma.
    const c = ler({
      ...PEDIDO,
      resource: {
        ...PEDIDO.resource,
        metadata: { data: [{ key: 'session_hash', value: ID }] },
      },
    });
    expect(c?.trckUserId).toBeNull();
  });

  it('aceita o id embrulhado em texto', () => {
    // O checkout pode devolver o valor com prefixo. O acerto é por regex de
    // 32 hexadecimais, não por igualdade.
    const c = ler({
      ...PEDIDO,
      resource: {
        ...PEDIDO.resource,
        metadata: { data: [{ key: 'trck_user_id', value: `rr-${ID}` }] },
      },
    });
    expect(c?.trckUserId).toBe(ID);
  });
});
