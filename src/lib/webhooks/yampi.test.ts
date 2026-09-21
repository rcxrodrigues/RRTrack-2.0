import { describe, expect, it, vi } from 'vitest';

import { yampi } from './yampi';
import { adoorei } from './adoorei';
import { lerWebhook } from './index';

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
  const c = yampi.normalizar(PEDIDO);

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
    expect(yampi.normalizar(payload)?.status).toBe('recusada');
  });

  it('nota fiscal não é dinheiro', () => {
    for (const event of ['order.invoice.created', 'order.invoice.updated']) {
      expect(yampi.normalizar({ ...PEDIDO, event }), event).toBeNull();
    }
  });

  it('order.status.updated decide pelo alias', () => {
    const c = yampi.normalizar({
      ...PEDIDO,
      event: 'order.status.updated',
      resource: { ...PEDIDO.resource, status: { data: { alias: 'refunded' } } },
    });
    expect(c?.status).toBe('estornada');
  });

  /*
   * A lista completa de aliases da Yampi ainda NÃO foi confirmada. Alias
   * desconhecido não vira venda: é avisado e a linha não nasce. O payload
   * fica inteiro em webhooks_recebidos, então nada se perde.
   */
  it('alias desconhecido avisa e NÃO inventa uma venda', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = yampi.normalizar({
      ...PEDIDO,
      event: 'order.status.updated',
      resource: { ...PEDIDO.resource, status: { data: { alias: 'em_separacao' } } },
    });
    expect(c).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('o vínculo com a visita', () => {
  const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

  it('acha no saco metadata', () => {
    const c = yampi.normalizar({
      ...PEDIDO,
      resource: { ...PEDIDO.resource, metadata: { data: [{ key: 'trck_user_id', value: ID }] } },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  it('NÃO confunde cart_id do exemplo com identificador de visita', () => {
    expect(yampi.normalizar(PEDIDO)?.trckUserId).toBeNull();
  });
});
