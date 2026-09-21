import { describe, expect, it, vi } from 'vitest';

import { pagou } from './pagou';
import { appmax } from './appmax';
import { lerWebhook } from './index';

/** O exemplo de webhook publicado no guia da Pagou, sem alteração. */
const PAGO = {
  id: 'evt_pay_1001',
  event: 'transaction',
  data: {
    event_type: 'transaction.paid',
    id: '018f1f2e-7b42-7c9a-8d3e-1a2b3c4d5e6f',
    status: 'paid',
    correlation_id: 'order_1001',
  },
};

const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('reconhece', () => {
  it('aceita o envelope de pagamento', () => {
    expect(pagou.reconhece(PAGO)).toBe(true);
  });

  it('recusa o que não é dela', () => {
    for (const alheio of [
      null,
      {},
      { event: 'transaction' },
      { id: 'x' },
      // Transferência: `type` no topo, não `event`. É payout, não venda.
      { id: 'evt_payout_1', type: 'payout.transferred', data: {} },
      { event: 'order_approved', event_type: 'order', data: {} },
    ]) {
      expect(pagou.reconhece(alheio), JSON.stringify(alheio)).toBe(false);
    }
  });
});

describe('normalizar', () => {
  it('lê o webhook mínimo publicado', () => {
    const c = pagou.normalizar(PAGO);
    expect(c?.transactionId).toBe('pagou:018f1f2e-7b42-7c9a-8d3e-1a2b3c4d5e6f');
    expect(c?.status).toBe('aprovada');
    expect(c?.evento).toBe('transaction.paid');
    // O webhook mínimo não traz valor. Nulo é honesto; zero seria mentira.
    expect(c?.valor).toBeNull();
  });

  it('aproveita o payload completo quando vier', () => {
    const c = pagou.normalizar({
      ...PAGO,
      data: {
        ...PAGO.data,
        amount: 25990,
        paid_amount: 25990,
        currency: 'BRL',
        paid_at: '2026-07-14T12:00:00.000Z',
        buyer: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '11999999999' },
        products: [{ sku: 'SKU-1', name: 'Curso', price: 25990, quantity: 1 }],
      },
    });
    expect(c?.valor).toBe(259.9);
    expect(c?.email).toBe('ada@example.com');
    expect(c?.primeiroNome).toBe('Ada');
    expect(c?.sobrenome).toBe('Lovelace');
    expect(c?.produtos[0]).toEqual({ id: 'SKU-1', nome: 'Curso', preco: 259.9, quantidade: 1 });
  });

  // Nome composto: a Meta quer fn e ln separados, a Pagou manda junto.
  it('separa nome de sobrenome, inclusive composto', () => {
    const c = pagou.normalizar({
      ...PAGO,
      data: { ...PAGO.data, buyer: { name: 'Maria da Silva Santos' } },
    });
    expect(c?.primeiroNome).toBe('Maria');
    expect(c?.sobrenome).toBe('da Silva Santos');
  });

  it('num partially_paid vale o que ENTROU, não o que foi cobrado', () => {
    const c = pagou.normalizar({
      ...PAGO,
      data: { ...PAGO.data, status: 'partially_paid', amount: 25990, paid_amount: 10000 },
    });
    expect(c?.valor).toBe(100);
    expect(c?.status).toBe('aprovada');
  });
});

describe('os 17 status', () => {
  it.each([
    ['paid', 'aprovada'], ['captured', 'aprovada'], ['processed', 'aprovada'],
    ['partially_paid', 'aprovada'],
    ['pending', 'pendente'], ['processing', 'pendente'], ['authorized', 'pendente'],
    ['three_ds_required', 'pendente'],
    ['refused', 'recusada'], ['canceled', 'recusada'], ['expired', 'recusada'],
    ['refunded', 'estornada'], ['partially_refunded', 'estornada'],
    ['chargedback', 'chargeback'], ['pre_chargedback', 'chargeback'],
    ['in_protest', 'chargeback'],
    // MED é devolução forçada pelo banco no Pix: contestação, não estorno.
    ['med', 'chargeback'],
  ])('%s → %s', (status, esperado) => {
    expect(pagou.normalizar({ ...PAGO, data: { ...PAGO.data, status } })?.status).toBe(esperado);
  });

  it('status desconhecido é avisado, não engolido', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pagou.normalizar({ ...PAGO, data: { ...PAGO.data, status: 'coisa_nova' } })).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('o vínculo com a visita', () => {
  it('acha em informations, que é a forma documentada', () => {
    const c = pagou.normalizar({
      ...PAGO,
      data: { ...PAGO.data, informations: [{ key: 'trck_user_id', value: ID }] },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  it('acha em correlation_id quando o checkout usa external_ref', () => {
    const c = pagou.normalizar({ ...PAGO, data: { ...PAGO.data, correlation_id: `ped-${ID}` } });
    expect(c?.trckUserId).toBe(ID);
  });

  /* `order_1001` do exemplo é referência do lojista, não da visita. */
  it('NÃO confunde referência do pedido com identificador de visita', () => {
    expect(pagou.normalizar(PAGO)?.trckUserId).toBeNull();
  });
});

describe('o que não é venda', () => {
  it('ignora assinatura', () => {
    expect(
      pagou.normalizar({ id: 'evt_sub_1', event: 'subscription', data: { event_type: 'subscription.created', id: 'x', status: 'active' } }),
    ).toBeNull();
  });
});

describe('os dois adaptadores não se confundem', () => {
  it('cada envelope vai para o seu dono', () => {
    const daPagou = lerWebhook(PAGO);
    expect(daPagou.tipo === 'venda' && daPagou.adaptador).toBe('pagou');

    const daAppmax = lerWebhook({
      event: 'order_approved',
      event_type: 'order',
      data: { order_id: 1, total: 100 },
    });
    expect(daAppmax.tipo === 'venda' && daAppmax.adaptador).toBe('appmax');
  });

  it('nenhum dos dois reivindica o payload do outro', () => {
    expect(pagou.reconhece({ event: 'order_approved', event_type: 'order', data: {} })).toBe(false);
    expect(appmax.reconhece(PAGO)).toBe(false);
  });
});
