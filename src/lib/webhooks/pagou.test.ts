import { describe, expect, it, vi } from 'vitest';

import { pagou } from './pagou';
import { soVenda } from './tipos';
import { appmax } from './appmax';
import { lerWebhook } from './index';

/** Normaliza e descarta o `Indeciso`: aqui só interessa se virou venda. */
const ler = (corpo: unknown) => soVenda(pagou.normalizar(corpo));

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
    const c = ler(PAGO);
    expect(c?.transactionId).toBe('pagou:018f1f2e-7b42-7c9a-8d3e-1a2b3c4d5e6f');
    expect(c?.status).toBe('aprovada');
    expect(c?.evento).toBe('transaction.paid');
    // O webhook mínimo não traz valor. Nulo é honesto; zero seria mentira.
    expect(c?.valor).toBeNull();
  });

  it('aproveita o payload completo quando vier', () => {
    const c = ler({
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
    const c = ler({
      ...PAGO,
      data: { ...PAGO.data, buyer: { name: 'Maria da Silva Santos' } },
    });
    expect(c?.primeiroNome).toBe('Maria');
    expect(c?.sobrenome).toBe('da Silva Santos');
  });

  it('num partially_paid vale o que ENTROU, não o que foi cobrado', () => {
    const c = ler({
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
    expect(ler({ ...PAGO, data: { ...PAGO.data, status } })?.status).toBe(esperado);
  });

  it('status desconhecido é avisado, não engolido', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ler({ ...PAGO, data: { ...PAGO.data, status: 'coisa_nova' } })).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('o vínculo com a visita', () => {
  it('acha em informations, que é a forma documentada', () => {
    const c = ler({
      ...PAGO,
      data: { ...PAGO.data, informations: [{ key: 'trck_user_id', value: ID }] },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  it('acha em correlation_id quando o checkout usa external_ref', () => {
    const c = ler({ ...PAGO, data: { ...PAGO.data, correlation_id: `ped-${ID}` } });
    expect(c?.trckUserId).toBe(ID);
  });

  /* `order_1001` do exemplo é referência do lojista, não da visita. */
  it('NÃO confunde referência do pedido com identificador de visita', () => {
    expect(ler(PAGO)?.trckUserId).toBeNull();
  });
});

describe('o que não é venda', () => {
  it('ignora assinatura', () => {
    expect(
      ler({ id: 'evt_sub_1', event: 'subscription', data: { event_type: 'subscription.created', id: 'x', status: 'active' } }),
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

/*
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ O payload PUBLICADO da Pagou, copiado da doc em 25/09/2026.             │
 * │ https://developer.pagou.ai/pt/webhooks/overview                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Escrever adaptador contra o payload real e não contra a minha leitura do
 * OpenAPI é a diferença entre ler o comprador e perdê-lo: eu tinha escrito
 * `buyer`, e o webhook manda `customer`.
 */
const PUBLICADO = {
  id: 'evt_pay_1001',
  event: 'transaction',
  api_version: 'v1',
  data: {
    id: '018f1f2e-7b42-7c9a-8d3e-1a2b3c4d5e6f',
    event_type: 'transaction.paid',
    correlation_id: 'order_1001',
    method: 'pix',
    status: 'paid',
    amount: 1500,
    currency: 'BRL',
    informations: [{ key: 'order_id', value: 'order_1001' }],
    customer: {
      name: 'Ana Souza',
      email: 'ana@example.com',
      phone: '+5511999998888',
    },
    products: [
      {
        id: '018f1f2e-7b42-7c9a-8d3e-9f0a1b2c3d4e',
        title: 'Curso completo',
        unit_price: 1500,
        quantity: 1,
        tangible: false,
        kind: 'product',
      },
    ],
    attribution: {
      utm_source: 'instagram',
      utm_medium: 'cpc',
      utm_campaign: 'black-friday',
      utm_content: null,
      utm_term: null,
      fbc: null,
      fbp: null,
      gclid: null,
      ttclid: null,
      src: null,
      sck: null,
      checkout_url: 'https://pay.example/checkout/abc',
      referrer_url: 'https://instagram.com/',
    },
  },
};

describe('o payload publicado da Pagou', () => {
  it('reconhece o envelope', () => {
    expect(pagou.reconhece(PUBLICADO)).toBe(true);
  });

  it('lê status, valor e moeda', () => {
    const c = ler(PUBLICADO);
    expect(c?.status).toBe('aprovada');
    // 1500 centavos = R$ 15,00. A Pagou é em centavos.
    expect(c?.valor).toBe(15);
    expect(c?.moeda).toBe('BRL');
    expect(c?.transactionId).toBe('pagou:018f1f2e-7b42-7c9a-8d3e-1a2b3c4d5e6f');
    expect(c?.evento).toBe('transaction.paid');
  });

  /*
   * O bug que este payload pegou. Eu lia `buyer`, do OpenAPI da CRIAÇÃO, e o
   * webhook manda `customer`. Sem e-mail o plano B do casamento nunca roda —
   * e numa venda criada por checkout link, onde `informations` não volta, o
   * e-mail é a única ponte que sobra. Toda venda da Pagou chegaria órfã.
   */
  it('lê o comprador de `customer`, que é o que o webhook manda', () => {
    const c = ler(PUBLICADO);
    expect(c?.email).toBe('ana@example.com');
    expect(c?.telefone).toBe('+5511999998888');
    expect(c?.primeiroNome).toBe('Ana');
    expect(c?.sobrenome).toBe('Souza');
  });

  it('continua lendo `buyer`, que é o nome na criação', () => {
    const c = ler({
      ...PUBLICADO,
      data: { ...PUBLICADO.data, customer: undefined, buyer: { email: 'b@x.com' } },
    });
    expect(c?.email).toBe('b@x.com');
  });

  it('lê o produto com `title` e `unit_price`', () => {
    const [produto] = ler(PUBLICADO)?.produtos ?? [];
    expect(produto?.nome).toBe('Curso completo');
    expect(produto?.preco).toBe(15);
  });

  it('a moeda não é cravada em BRL — a Pagou opera em MXN também', () => {
    const c = ler({
      ...PUBLICADO,
      data: { ...PUBLICADO.data, currency: 'MXN', amount: 125000 },
    });
    expect(c?.moeda).toBe('MXN');
    expect(c?.valor).toBe(1250);
  });
});

describe('a atribuição que o checkout da Pagou captura', () => {
  it('traz fbp, fbc e as UTMs quando existem', () => {
    const c = ler({
      ...PUBLICADO,
      data: {
        ...PUBLICADO.data,
        attribution: {
          ...PUBLICADO.data.attribution,
          fbp: 'fb.1.1699999999.123456789',
          fbc: 'fb.1.1699999999.AbCdEf',
        },
      },
    });

    expect(c?.atribuicao?.fbp).toBe('fb.1.1699999999.123456789');
    expect(c?.atribuicao?.fbc).toBe('fb.1.1699999999.AbCdEf');
    expect(c?.atribuicao?.utmSource).toBe('instagram');
    expect(c?.atribuicao?.utmCampaign).toBe('black-friday');
  });

  it('objeto presente e todo nulo NÃO é atribuição', () => {
    const c = ler({
      ...PUBLICADO,
      data: {
        ...PUBLICADO.data,
        attribution: { utm_source: null, fbp: null, fbc: null },
      },
    });
    expect(c?.atribuicao).toBeUndefined();
  });

  it('sem `attribution`, fica sem — e não quebra', () => {
    const c = ler({
      ...PUBLICADO,
      data: { ...PUBLICADO.data, attribution: undefined },
    });
    expect(c?.atribuicao).toBeUndefined();
    expect(c?.status).toBe('aprovada');
  });

  /*
   * A doc é explícita: `informations` "só aparece quando você enviou
   * entradas customizadas na criação; transações criadas por CHECKOUT LINKS
   * omitem o campo". Numa loja que manda o comprador para um link — que é o
   * caso da primeira oferta — a ponte documentada não volta, e `src`/`sck`
   * são o que atravessa, porque são parâmetros de URL.
   */
  it('usa src/sck como ponte quando informations não volta', () => {
    const visita = 'a'.repeat(32);
    const c = ler({
      ...PUBLICADO,
      data: {
        ...PUBLICADO.data,
        informations: undefined,
        correlation_id: 'order_1001',
        attribution: { ...PUBLICADO.data.attribution, src: visita },
      },
    });
    expect(c?.trckUserId).toBe(visita);
  });

  it('o sck também serve', () => {
    const visita = 'b'.repeat(32);
    const c = ler({
      ...PUBLICADO,
      data: {
        ...PUBLICADO.data,
        informations: undefined,
        correlation_id: undefined,
        attribution: { ...PUBLICADO.data.attribution, sck: visita },
      },
    });
    expect(c?.trckUserId).toBe(visita);
  });

  it('`order_1001` no correlation_id NÃO vira identificador de visita', () => {
    // O acerto é por regex de 32 hexadecimais. Aceitar texto qualquer ali
    // ligaria todas as vendas ao mesmo fantasma.
    expect(ler(PUBLICADO)?.trckUserId).toBeNull();
  });
});
