import { describe, expect, it, vi } from 'vitest';

import { appmax } from './appmax';

/**
 * Os payloads abaixo são os EXEMPLOS DA DOCUMENTAÇÃO da Appmax, copiados sem
 * alteração. Inventar um payload "parecido" e testar contra ele só prova que
 * o código concorda consigo mesmo.
 */

const APROVADO_CARTAO = {
  event: 'order_approved',
  event_type: 'order',
  site_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  app_id: 'f9e8d7c6-b5a4-3210-fedc-ba0987654321',
  client_key: 'merchant-key-123',
  external_key: 'ext-order-456',
  data: {
    order_id: 3531,
    status: 'aprovado',
    total: 25990,
    freight_value: 1500,
    merchant_total: 23400,
    discount: 0,
    interest: 0,
    paid_at: '2025-03-15 14:30:00',
    created_at: '2025-03-15 14:28:00',
    products: [{ sku: 'PROD-001', name: 'Curso de Marketing Digital', price: 25990, quantity: 1 }],
    payment_info: {
      credit_card: { installments: 3, card_brand: 'visa', nsu: '0012345678' },
    },
    client_key: 'merchant-key-123',
    external_key: 'ext-order-456',
    notification_type: 'order_approved',
  },
  partner_merchant: { merchant_email: 'loja@exemplo.com' },
};

const PIX_PAGO = {
  event: 'order_paid_by_pix',
  event_type: 'order',
  client_key: null,
  external_key: null,
  data: {
    order_id: 4201,
    status: 'aprovado',
    total: 9900,
    freight_value: 0,
    paid_at: '2025-03-15 15:10:00',
    created_at: '2025-03-15 15:05:00',
    products: [{ sku: 'EBOOK-042', name: 'E-book Receitas Fit', price: 9900, quantity: 1 }],
    client_key: null,
    external_key: null,
  },
};

const CLIENTE_CRIADO = {
  event: 'customer_created',
  event_type: 'customer',
  data: {
    customer_id: 2023,
    customer_data: { firstname: 'Junior', lastname: 'Almeida', email: 'junior.almeida@email.com' },
  },
};

describe('reconhece', () => {
  it('aceita o envelope da Appmax', () => {
    expect(appmax.reconhece(APROVADO_CARTAO)).toBe(true);
    expect(appmax.reconhece(CLIENTE_CRIADO)).toBe(true);
  });

  // O formato do PAINEL não tem app_id nem site_id — e é o que devemos
  // receber, sendo merchant. Exigir esses campos nos deixaria cegos.
  it('aceita sem app_id e sem site_id', () => {
    expect(appmax.reconhece({ event: 'order_paid', event_type: 'order', data: {} })).toBe(true);
  });

  it('recusa o que não é dela', () => {
    for (const alheio of [
      null,
      {},
      'texto',
      { event: 'order_approved' },
      { event: 'charge.paid', event_type: 'charge' },
      { id: 1, status: 'paid' },
    ]) {
      expect(appmax.reconhece(alheio), JSON.stringify(alheio)).toBe(false);
    }
  });
});

describe('normalizar — venda aprovada', () => {
  const c = appmax.normalizar(APROVADO_CARTAO);

  /*
   * O erro de 100× que NÃO dá erro: 25990 centavos é R$ 259,90. Tratado como
   * reais viraria R$ 25.990 e o ROAS mentiria por duas ordens de grandeza,
   * sem nada quebrar.
   */
  it('converte centavos para reais', () => {
    expect(c?.valor).toBe(259.9);
    expect(c?.produtos[0]?.preco).toBe(259.9);
  });

  it('identifica a venda pelo pedido, com a plataforma na frente', () => {
    expect(c?.transactionId).toBe('appmax:3531');
  });

  it('guarda o evento original para auditoria', () => {
    expect(c?.evento).toBe('order_approved');
    expect(c?.status).toBe('aprovada');
  });

  it('traz os produtos', () => {
    expect(c?.produtos).toEqual([
      { id: 'PROD-001', nome: 'Curso de Marketing Digital', preco: 259.9, quantidade: 1 },
    ]);
  });

  it('assume real — a Appmax não manda campo de moeda', () => {
    expect(c?.moeda).toBe('BRL');
  });
});

describe('normalizar — os quatro eventos de um cartão viram UMA venda', () => {
  /*
   * order_authorized → order_approved → order_paid → order_integrated, todos
   * com o mesmo order_id. Se cada um virasse uma linha, a mesma venda
   * apareceria quatro vezes no faturamento.
   */
  it('todos devolvem o mesmo transactionId', () => {
    const ids = ['order_authorized', 'order_approved', 'order_paid'].map(
      (event) => appmax.normalizar({ ...APROVADO_CARTAO, event })?.transactionId,
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe('appmax:3531');
  });

  it('mas cada um com o seu significado', () => {
    expect(appmax.normalizar({ ...APROVADO_CARTAO, event: 'order_authorized' })?.status).toBe('pendente');
    expect(appmax.normalizar({ ...APROVADO_CARTAO, event: 'order_approved' })?.status).toBe('aprovada');
  });
});

describe('normalizar — o que desfaz receita', () => {
  it.each([
    ['order_refund', 'estornada'],
    ['order_partial_refund', 'estornada'],
    ['order_chargeback_in_treatment', 'chargeback'],
  ])('%s → %s', (event, esperado) => {
    expect(appmax.normalizar({ ...APROVADO_CARTAO, event })?.status).toBe(esperado);
  });

  // Chargeback julgado a favor do lojista: o dinheiro fica, a receita volta.
  it('order_charge_back_gain volta a valer como aprovada', () => {
    expect(appmax.normalizar({ ...APROVADO_CARTAO, event: 'order_charge_back_gain' })?.status).toBe(
      'aprovada',
    );
  });
});

describe('normalizar — o que NÃO é venda', () => {
  it('ignora evento de cliente', () => {
    expect(appmax.normalizar(CLIENTE_CRIADO)).toBeNull();
  });

  it('ignora order_integrated — é etapa, não dinheiro', () => {
    expect(appmax.normalizar({ ...APROVADO_CARTAO, event: 'order_integrated' })).toBeNull();
  });

  /*
   * Um ciclo de assinatura gera pedido próprio e chega TAMBÉM como order_*.
   * Tratar os dois contaria a mesma receita duas vezes.
   */
  it('ignora assinatura inteira', () => {
    expect(
      appmax.normalizar({
        event: 'subscription_charge_success',
        event_type: 'subscription',
        data: { subscription_id: 501, order_id: 3987, total: 4990 },
      }),
    ).toBeNull();
  });

  it('evento desconhecido é AVISADO, não engolido em silêncio', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(appmax.normalizar({ ...APROVADO_CARTAO, event: 'order_coisa_nova' })).toBeNull();
    expect(aviso).toHaveBeenCalledWith('[appmax] evento não mapeado:', 'order_coisa_nova');
    aviso.mockRestore();
  });

  it('evento sem order_id não vira venda', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(appmax.normalizar({ event: 'order_approved', event_type: 'order', data: {} })).toBeNull();
    aviso.mockRestore();
  });
});

describe('o vínculo com a visita', () => {
  const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

  it('acha o identificador em external_key', () => {
    const c = appmax.normalizar({
      ...APROVADO_CARTAO,
      data: { ...APROVADO_CARTAO.data, external_key: ID },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  it('acha em client_key quando external_key não tem', () => {
    const c = appmax.normalizar({
      ...APROVADO_CARTAO,
      data: { ...APROVADO_CARTAO.data, external_key: null, client_key: ID },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  // O checkout pode devolver o valor embrulhado em texto.
  it('acha o identificador dentro de um texto maior', () => {
    const c = appmax.normalizar({
      ...APROVADO_CARTAO,
      data: { ...APROVADO_CARTAO.data, external_key: `origem=site;trck=${ID};v=2` },
    });
    expect(c?.trckUserId).toBe(ID);
  });

  /*
   * O caso REAL do exemplo da doc: as chaves vêm com valores do merchant, que
   * não são identificador nosso. Devolver "merchant-key-123" como se fosse o
   * visitante ligaria TODAS as vendas ao mesmo fantasma.
   */
  it('NÃO confunde chave do merchant com identificador de visita', () => {
    expect(appmax.normalizar(APROVADO_CARTAO)?.trckUserId).toBeNull();
    expect(appmax.normalizar(PIX_PAGO)?.trckUserId).toBeNull();
  });
});

describe('o cliente', () => {
  /*
   * Nos eventos order_* documentados NÃO vem cliente nenhum — ver
   * docs/gateways/appmax.md. Lemos assim mesmo porque o formato do Painel
   * pode trazer; se não trouxer, fica nulo e nada quebra.
   */
  it('fica nulo quando o pedido não traz cliente (o caso documentado)', () => {
    const c = appmax.normalizar(APROVADO_CARTAO);
    expect(c?.email).toBeNull();
    expect(c?.telefone).toBeNull();
  });

  it('aproveita o cliente quando o payload trouxer', () => {
    const c = appmax.normalizar({
      ...APROVADO_CARTAO,
      data: {
        ...APROVADO_CARTAO.data,
        customer_data: {
          firstname: 'Junior',
          lastname: 'Almeida',
          email: 'junior@email.com',
          telephone: '51983655100',
        },
      },
    });
    expect(c?.email).toBe('junior@email.com');
    expect(c?.telefone).toBe('51983655100');
    expect(c?.primeiroNome).toBe('Junior');
    expect(c?.sobrenome).toBe('Almeida');
  });
});

describe('pix', () => {
  it('normaliza o pix pago', () => {
    const c = appmax.normalizar(PIX_PAGO);
    expect(c?.status).toBe('aprovada');
    expect(c?.valor).toBe(99);
    expect(c?.transactionId).toBe('appmax:4201');
  });

  it('pix expirado não é venda aprovada', () => {
    expect(appmax.normalizar({ ...PIX_PAGO, event: 'order_pix_expired' })?.status).toBe('recusada');
  });
});
