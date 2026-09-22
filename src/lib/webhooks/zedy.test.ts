import { describe, expect, it, vi } from 'vitest';

import { zedy } from './zedy';
import { soVenda } from './tipos';
import { lerWebhook } from './index';

/** Normaliza e descarta o `Indeciso`: aqui só interessa se virou venda. */
const ler = (corpo: unknown) => soVenda(zedy.normalizar(corpo));

/** O exemplo da documentação da Zedy, copiado sem alteração. */
const ABANDONADO = {
  eventType: 'CART_ABANDONED',
  title: 'Zedy | Pedido Z-13CEM05RWG261 Carrinho abandonado',
  orderId: 'Z-13CEM05RWG261',
  platform: 'ZedyCheckout',
  currency: 'BRL',
  paymentMethod: 'pix',
  status: 'waiting_payment',
  createdAt: '2026-07-02T11:28:11.318Z',
  approvedDate: null,
  refundedAt: null,
  customer: {
    name: 'Fulano de Tal',
    email: 'fulano@email.com',
    phone: '21999998888',
    document: '00000000000',
    country: 'BR',
    ip: '179.10.10.10',
  },
  products: [
    {
      id: 121744347,
      name: 'Produto Exemplo',
      planId: 121744347,
      planName: 'Produto Exemplo',
      quantity: 1,
      priceInCents: 9700,
      image: 'https://cdn.exemplo.com/produto.jpg',
    },
  ],
  coupons: [],
  trackingParameters: {
    src: null, sck: null, utm_source: 'instagram',
    utm_campaign: 'julho', utm_medium: 'bio', utm_content: null, utm_term: null,
  },
  commission: {
    totalPriceInCents: 9700,
    gatewayFeeInCents: 300,
    userCommissionInCents: 9400,
  },
  isTest: false,
  pixQrCode: '',
  abandonouNa: 'Dados pessoais',
};

const PAGO = { ...ABANDONADO, eventType: 'ORDER_PAID', status: 'paid', approvedDate: '2026-07-02T11:35:00.000Z' };

describe('reconhece', () => {
  it('aceita o envelope plano da Zedy', () => {
    expect(zedy.reconhece(ABANDONADO)).toBe(true);
  });

  /* Nenhuma das outras quatro tem eventType em MAIÚSCULAS com orderId no topo. */
  it('recusa o payload das outras', () => {
    for (const alheio of [
      null, {},
      { event: 'order_approved', event_type: 'order', data: {} },
      { id: 'evt', event: 'transaction', data: {} },
      { event: 'order.paid', time: 'x', merchant: {}, resource: { status: { data: {} } } },
      { event: 'order.created', time: 'x', merchant: {}, resource: { status: 'approved' } },
    ]) {
      expect(zedy.reconhece(alheio), JSON.stringify(alheio)).toBe(false);
    }
  });
});

describe('a armadilha do valor', () => {
  /*
   * Centavos, como Appmax e Pagou — e ao contrário de Yampi e Adoorei. A
   * Zedy ajuda: a unidade está no nome do campo (`priceInCents`).
   */
  it('converte centavos para reais', () => {
    expect(ler(PAGO)?.valor).toBe(97);
    expect(ler(PAGO)?.produtos[0]?.preco).toBe(97);
  });

  /*
   * `totalPriceInCents` é o BRUTO, o que o cliente pagou.
   * `userCommissionInCents` (9400) é o líquido, já sem a taxa. Para ROAS o
   * que vale é o bruto — usar o líquido faria o retorno parecer menor do
   * que é e a campanha ser cortada à toa.
   */
  it('usa o BRUTO, não o líquido depois da taxa', () => {
    expect(ler(PAGO)?.valor).toBe(97);
    expect(ler(PAGO)?.valor).not.toBe(94);
  });
});

describe('normalizar', () => {
  const c = ler(PAGO);

  it('identifica pelo orderId, que a doc manda usar para deduplicar', () => {
    expect(c?.transactionId).toBe('zedy:Z-13CEM05RWG261');
  });

  it('traz o cliente, com nome separado e IP', () => {
    expect(c?.email).toBe('fulano@email.com');
    expect(c?.telefone).toBe('21999998888');
    expect(c?.primeiroNome).toBe('Fulano');
    expect(c?.sobrenome).toBe('de Tal');
    expect(c?.ipCliente).toBe('179.10.10.10');
  });

  it('traz o produto', () => {
    expect(c?.produtos[0]).toEqual({
      id: '121744347', nome: 'Produto Exemplo', preco: 97, quantidade: 1,
    });
  });
});

describe('os quatro status', () => {
  /*
   * A própria doc manda: "Use o status do payload como fonte de verdade,
   * não a sequência" — a ordem de chegada dos eventos não é garantida.
   */
  it.each([
    ['paid', 'aprovada'],
    ['waiting_payment', 'pendente'],
    ['refused', 'recusada'],
    ['refunded', 'estornada'],
  ])('%s → %s', (status, esperado) => {
    expect(ler({ ...PAGO, status })?.status).toBe(esperado);
  });

  it('o status manda, não o eventType', () => {
    // Evento diz que foi pago; o status diz que foi estornado. Vale o status.
    const c = ler({ ...PAGO, eventType: 'ORDER_PAID', status: 'refunded' });
    expect(c?.status).toBe('estornada');
  });

  it('status desconhecido avisa e não inventa venda', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ler({ ...PAGO, status: 'coisa_nova' })).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('pedido de TESTE', () => {
  /*
   * Mandar um teste para a Meta como Purchase ensina o otimizador a
   * perseguir venda que não existe, e infla o faturamento do painel. Fica
   * guardado em webhooks_recebidos, então nada se perde — só não conta.
   */
  it('isTest não vira conversão', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ler({ ...PAGO, isTest: true })).toBeNull();
    aviso.mockRestore();
  });

  it('isTest false segue normal', () => {
    expect(ler({ ...PAGO, isTest: false })?.status).toBe('aprovada');
  });
});

describe('o vínculo com a visita', () => {
  const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

  it.each(['src', 'sck'])('acha em trackingParameters.%s', (campo) => {
    const c = ler({
      ...PAGO,
      trackingParameters: { ...PAGO.trackingParameters, [campo]: ID },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  /* O exemplo traz utm_source: "instagram" — origem, não identificador. */
  it('NÃO confunde UTM com identificador de visita', () => {
    expect(ler(PAGO)?.trckUserId).toBeNull();
  });
});

describe('os cinco adaptadores, lado a lado', () => {
  it('cada envelope vai para o seu dono', () => {
    const casos: [unknown, string][] = [
      [PAGO, 'zedy'],
      [{ event: 'order_approved', event_type: 'order', data: { order_id: 1, total: 100 } }, 'appmax'],
      [{ id: 'e', event: 'transaction', data: { id: 'x', status: 'paid' } }, 'pagou'],
      [{ event: 'order.paid', time: 't', merchant: {}, resource: { id: 1, status: { data: { alias: 'paid' } } } }, 'yampi'],
      [{ event: 'order.status.approved', time: 't', merchant: {}, resource: { number: 2, status: 'approved', value_total: 10 } }, 'adoorei'],
    ];
    for (const [payload, dono] of casos) {
      const leitura = lerWebhook(payload);
      expect(leitura.tipo === 'venda' && leitura.adaptador, dono).toBe(dono);
    }
  });
});
