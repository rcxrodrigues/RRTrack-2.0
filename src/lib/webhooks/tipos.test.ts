import { describe, expect, it } from 'vitest';

import {
  deCentavos,
  ehIndeciso,
  ehStatusCompra,
  indeciso,
  soVenda,
  STATUS_COMPRA,
  STATUS_QUE_DESFAZEM,
  type CompraNormalizada,
} from './tipos';

/**
 * As três travas do vocabulário do faturamento.
 *
 * Todas guardam a mesma fronteira: o que vem de fora — payload de gateway,
 * cadastro digitado no painel — não pode virar status sem passar por aqui.
 */

describe('ehStatusCompra', () => {
  it('aceita os cinco, e só eles', () => {
    for (const status of STATUS_COMPRA) {
      expect(ehStatusCompra(status), status).toBe(true);
    }
  });

  /*
   * O cadastro do painel é digitado à mão. Um `status` inventado ali
   * atravessaria o mapa, o adaptador e o disparo — e chegaria à Meta como
   * conversão de um tipo que não existe.
   */
  it('recusa o que não é um dos cinco', () => {
    const invencoes = ['paga', 'aprovado', 'APROVADA', 'refunded', 'ok', ''];
    for (const texto of invencoes) {
      expect(ehStatusCompra(texto), texto).toBe(false);
    }
  });

  it('os que desfazem são um subconjunto dos cinco', () => {
    for (const status of STATUS_QUE_DESFAZEM) {
      expect(STATUS_COMPRA).toContain(status);
    }
  });
});

describe('indeciso', () => {
  const VENDA: CompraNormalizada = {
    plataforma: 'yampi',
    transactionId: 'yampi:1',
    evento: 'order.paid',
    status: 'aprovada',
    valor: 10,
    moeda: 'BRL',
    trckUserId: null,
    email: null,
    telefone: null,
    primeiroNome: null,
    sobrenome: null,
    produtos: [],
    ipCliente: null,
    ocorridoEm: null,
  };

  it('reconhece o indeciso e carrega o motivo', () => {
    const i = indeciso('alias "devolvido" não está mapeado');
    expect(ehIndeciso(i)).toBe(true);
    expect(i.motivo).toContain('devolvido');
  });

  /*
   * A confusão que isto evita: uma venda é um objeto, o indeciso é outro, e
   * `null` é o terceiro caso. Tratar indeciso como venda mandaria uma
   * conversão sem status para a Meta.
   */
  it('não confunde venda, null nem objeto qualquer com indeciso', () => {
    expect(ehIndeciso(VENDA)).toBe(false);
    expect(ehIndeciso(null)).toBe(false);
    expect(ehIndeciso(undefined)).toBe(false);
    expect(ehIndeciso({ indeciso: 'sim' })).toBe(false);
    expect(ehIndeciso({ motivo: 'sem a marca' })).toBe(false);
  });

  it('soVenda devolve a venda e engole o indeciso', () => {
    expect(soVenda(VENDA)).toBe(VENDA);
    expect(soVenda(indeciso('qualquer'))).toBeNull();
    expect(soVenda(null)).toBeNull();
  });
});

describe('deCentavos', () => {
  it('converte com duas casas exatas', () => {
    expect(deCentavos(25990)).toBe(259.9);
    expect(deCentavos(9700)).toBe(97);
    expect(deCentavos(1)).toBe(0.01);
  });

  it('zero é um valor, não ausência', () => {
    // Cupom de 100% existe, e a venda continua sendo venda.
    expect(deCentavos(0)).toBe(0);
  });

  it('o que não é número vira null', () => {
    expect(deCentavos(undefined)).toBeNull();
    expect(deCentavos(null)).toBeNull();
    expect(deCentavos('25990')).toBeNull();
  });
});
