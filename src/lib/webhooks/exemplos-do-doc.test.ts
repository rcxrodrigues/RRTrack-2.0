import { describe, expect, it } from 'vitest';

import { lerWebhook } from './index';

/**
 * Os payloads de `docs/TESTAR-VENDA.md`, exercitados de verdade.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DOCUMENTO COM EXEMPLO QUEBRADO É PIOR QUE DOCUMENTO NENHUM.               │
 * │                                                                          │
 * │ Quem cola um curl do doc e leva 202 conclui que o SISTEMA está errado,   │
 * │ não o exemplo — e vai depurar o lugar errado, justo no dia em que está   │
 * │ tentando ligar o checkout. Estes testes prendem o doc ao código: mexeu   │
 * │ no adaptador e o exemplo parou de valer, quebra aqui, não lá.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * As duas asserções que importam em cada um:
 *
 * 1. **O adaptador reconhece** — senão a rota devolve 202 e a venda fica
 *    parada em `webhooks_recebidos`.
 * 2. **O `trck_user_id` foi extraído** — que é o ponto do teste inteiro. Cada
 *    gateway o devolve num campo diferente, e mandar no campo errado **não
 *    dá erro**: o checkout ignora, a venda entra e chega órfã. Um exemplo
 *    com o campo errado ensinaria exatamente o erro que ele existe para
 *    evitar.
 */

const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

/** Cada exemplo do doc, com `SEU_TRCK_USER_ID` já substituído. */
const EXEMPLOS: { gateway: string; corpo: unknown }[] = [
  {
    gateway: 'appmax',
    corpo: {
      event: 'order_authorized',
      event_type: 'order',
      client_key: ID,
      data: {
        order_id: 999001,
        status: 'aguardando_pagamento',
        total: 25990,
        customer: { email: 'teste@exemplo.com', firstname: 'Teste' },
        products: [
          { sku: 'TESTE-1', name: 'Produto de teste', price: 25990, quantity: 1 },
        ],
        client_key: ID,
      },
    },
  },
  {
    gateway: 'yampi',
    corpo: {
      event: 'order.created',
      time: '2026-09-27T10:00:00Z',
      merchant: { alias: 'minha-loja' },
      resource: {
        id: 999002,
        value_total: 199.9,
        status: { data: { alias: 'waiting_payment' } },
        customer: { data: { email: 'teste@exemplo.com', name: 'Teste' } },
        metadata: { data: [{ key: 'trck_user_id', value: ID }] },
      },
    },
  },
  {
    gateway: 'zedy',
    corpo: {
      eventType: 'ORDER_CREATED',
      orderId: 'Z-999003',
      status: 'waiting_payment',
      customer: { name: 'Teste', email: 'teste@exemplo.com', country: 'BR' },
      products: [
        { id: 1, name: 'Produto de teste', quantity: 1, priceInCents: 9700 },
      ],
      commission: { totalPriceInCents: 9700 },
      trackingParameters: { src: ID, utm_source: 'teste' },
      isTest: false,
    },
  },
  {
    gateway: 'adoorei',
    corpo: {
      event: 'order.created',
      time: '2026-09-27T10:00:00Z',
      merchant: { id: 1 },
      resource: {
        number: 999004,
        status: 'pending',
        value_total: 110.0,
        source_reference: ID,
        customer: { email: 'teste@exemplo.com', nome: 'Teste' },
      },
    },
  },
  {
    gateway: 'pagou',
    corpo: {
      id: 'evt-teste',
      event: 'transaction',
      data: {
        id: '999005',
        status: 'pending',
        amount: 25990,
        payer: { email: 'teste@exemplo.com', name: 'Teste' },
        informations: [{ key: 'trck_user_id', value: ID }],
      },
    },
  },
];

describe('os exemplos de docs/TESTAR-VENDA.md', () => {
  it.each(EXEMPLOS)('$gateway: o adaptador certo reconhece', ({ gateway, corpo }) => {
    const lido = lerWebhook(corpo, { statusPorAlias: {} });
    // 'desconhecido' aqui significaria 202 na rota e curl "falhando" à toa.
    expect(lido.tipo, JSON.stringify(lido)).toBe('venda');
    if (lido.tipo !== 'venda') return;
    // E tem de ser o adaptador DAQUELE gateway: Yampi e Adoorei usam o mesmo
    // envelope, e um engolindo o payload do outro leria tudo errado.
    expect(lido.adaptador).toBe(gateway);
  });

  it.each(EXEMPLOS)('$gateway: o trck_user_id atravessa', ({ corpo }) => {
    const lido = lerWebhook(corpo, { statusPorAlias: {} });
    if (lido.tipo !== 'venda') throw new Error('não virou venda');
    expect(lido.compra.trckUserId).toBe(ID);
  });

  it.each(EXEMPLOS)('$gateway: entra como PENDENTE, sem disparar a Meta', ({ corpo }) => {
    /*
     * É a trava do Passo 1 do doc. Só `aprovada` dispara conversão; se algum
     * destes exemplos virasse `aprovada` sem querer, o "teste seguro"
     * mandaria um Purchase de verdade para o pixel — e a Conversions API não
     * tem como desfazer.
     */
    const lido = lerWebhook(corpo, { statusPorAlias: {} });
    if (lido.tipo !== 'venda') throw new Error('não virou venda');
    expect(lido.compra.status).toBe('pendente');
  });
});
