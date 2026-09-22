import { describe, expect, it, vi } from 'vitest';

import { adoorei } from './adoorei';
import { soVenda } from './tipos';
import { lerWebhook } from './index';

/** Normaliza e descarta o `Indeciso`: aqui só interessa se virou venda. */
const ler = (corpo: unknown) => soVenda(adoorei.normalizar(corpo));

/** O exemplo da documentação da Adoorei, copiado sem alteração. */
const PEDIDO = {
  event: 'order.status.approved',
  time: '2022-04-13T19:58:04.000000Z',
  merchant: { id: '1', alias: 'lojateste' },
  resource: {
    status: 'approved',
    number: 2,
    value_total: 110.0,
    value_products: 100.0,
    value_shipment: 10.0,
    value_discount: 0.0,
    days_delivery: '1 a 3 dias',
    upselled: false,
    gateway: 'appmax',
    payment_method: 'credit_card',
    source: 'shopify',
    source_reference: null,
    gateway_transaction_id: null,
    customer: {
      first_name: 'Nome',
      last_name: 'Sobrenome',
      doc: '99999999999',
      ip: '127.0.0.1',
      email: 'nome@email.com',
      phone: '99999999999',
    },
    items: [{ source_reference: 40085810839652, quantity: 1, price: 100.0 }],
    address: { street: 'Rua Teste', city: 'Cidade', uf: 'UF', zipcode: '11111-111' },
  },
};

const CARRINHO = {
  event: 'cart.abandoned',
  time: '2022-04-13T19:58:04.000000Z',
  merchant: { id: '1', alias: 'lojateste' },
  resource: {
    checkout_token: '0e5a4ed1c99396150ccf331d3e6ade30',
    checkout_url: 'https://lojateste.com/0e5a4ed1c99396150ccf331d3e6ade30',
    total: 100.0,
    customer: { name: 'Nome Completo', email: 'nomecompleto@email.com' },
    products: [{ id: 4008582, name: 'Produto Teste', price: 100, qty: 1 }],
  },
};

describe('a armadilha do valor', () => {
  /*
   * O ponto mais importante deste arquivo. A Adoorei manda REAIS
   * (`110.00`); a Appmax e a Pagou mandam CENTAVOS (`25990`). Converter
   * aqui daria R$ 1,10 — erro de 100× que não quebra nada e só aparece
   * semanas depois, num ROAS absurdo que ninguém sabe explicar.
   */
  it('valor em REAIS, sem conversão', () => {
    expect(ler(PEDIDO)?.valor).toBe(110);
  });

  it('preço do item também em reais', () => {
    expect(ler(PEDIDO)?.produtos[0]?.preco).toBe(100);
  });
});

describe('normalizar', () => {
  const c = ler(PEDIDO);

  it('identifica pelo número do pedido', () => {
    expect(c?.transactionId).toBe('adoorei:2');
  });

  it('lê o status e guarda o evento original', () => {
    expect(c?.status).toBe('aprovada');
    expect(c?.evento).toBe('order.status.approved');
  });

  /*
   * Diferente da Appmax, cujo evento de pedido não traz cliente nenhum:
   * aqui o plano B da atribuição (e-mail → telefone) funciona de verdade.
   */
  it('traz o cliente completo, com nome já separado', () => {
    expect(c?.email).toBe('nome@email.com');
    expect(c?.telefone).toBe('99999999999');
    expect(c?.primeiroNome).toBe('Nome');
    expect(c?.sobrenome).toBe('Sobrenome');
  });

  it('traz o item, mesmo sem nome — o pedido não manda o nome', () => {
    expect(c?.produtos[0]).toEqual({
      id: '40085810839652',
      nome: null,
      preco: 100,
      quantidade: 1,
    });
  });
});

describe('os cinco eventos de um pedido viram UMA venda', () => {
  it('todos devolvem o mesmo transactionId', () => {
    const ids = [
      'order.created',
      'order.updated',
      'order.status.updated',
      'order.status.approved',
    ].map((event) => ler({ ...PEDIDO, event })?.transactionId);
    expect(new Set(ids).size).toBe(1);
  });

  // Quem decide é o `status`, não o evento: a Adoorei publica os oito.
  it('o significado vem do status, não do nome do evento', () => {
    const c = ler({
      ...PEDIDO,
      event: 'order.status.approved',
      resource: { ...PEDIDO.resource, status: 'refunded' },
    });
    expect(c?.status).toBe('estornada');
  });
});

describe('os oito status', () => {
  it.each([
    ['approved', 'aprovada'],
    ['pending', 'pendente'],
    // Anti-fraude avaliando: o dinheiro não é seu até sair de lá.
    ['in_analysis', 'pendente'],
    ['refused', 'recusada'],
    ['cancelled', 'recusada'],
    ['failed', 'recusada'],
    ['refunded', 'estornada'],
    ['chargeback', 'chargeback'],
  ])('%s → %s', (status, esperado) => {
    const c = ler({ ...PEDIDO, resource: { ...PEDIDO.resource, status } });
    expect(c?.status).toBe(esperado);
  });

  it('status desconhecido é avisado, não engolido', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      ler({ ...PEDIDO, resource: { ...PEDIDO.resource, status: 'novo' } }),
    ).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('o que não é venda', () => {
  it('carrinho abandonado não vira compra', () => {
    expect(adoorei.reconhece(CARRINHO)).toBe(true);
    expect(ler(CARRINHO)).toBeNull();
  });
});

describe('os quatro adaptadores não se confundem', () => {
  it('cada envelope vai para o seu dono', () => {
    const casos: [unknown, string][] = [
      [PEDIDO, 'adoorei'],
      [{ event: 'order_approved', event_type: 'order', data: { order_id: 1, total: 100 } }, 'appmax'],
      [{ id: 'evt_1', event: 'transaction', data: { id: 'x', status: 'paid' } }, 'pagou'],
    ];
    for (const [payload, dono] of casos) {
      const leitura = lerWebhook(payload);
      expect(leitura.tipo === 'venda' && leitura.adaptador, dono).toBe(dono);
    }
  });

  /*
   * A Appmax também usa `event`, e a Adoorei também usa `order.` — o que
   * separa é o envelope: merchant + resource só a Adoorei tem.
   */
  it('a Adoorei não reivindica o payload da Appmax', () => {
    expect(adoorei.reconhece({ event: 'order_approved', event_type: 'order', data: {} })).toBe(false);
  });
});
