import { describe, expect, it } from 'vitest';

import type { EventoPorTipo } from './consultas';

import { etapaDe, montarFunil } from './funil';

/**
 * O funil erra de um jeito específico: ele engorda no meio.
 *
 * Acontece por contar EVENTOS em vez de pessoas — quem abriu o checkout três
 * vezes vira três —, e o gráfico resultante não é só feio: é ilegível, porque
 * funil que alarga não tem leitura.
 */

function evento(nome: string, total: number, visitantes: number): EventoPorTipo {
  return { nome, total, visitantes };
}

const CARRINHO = evento('AddToCart', 60, 40);
const CHECKOUT = evento('InitiateCheckout', 30, 20);

describe('montarFunil', () => {
  it('conta PESSOAS, não eventos', () => {
    const { etapas } = montarFunil(100, [CARRINHO, CHECKOUT], 5);
    // 60 eventos de carrinho, 40 pessoas. Vale 40.
    expect(etapaDe({ etapas, eventosFaltando: [] }, 'carrinho')?.total).toBe(40);
    expect(etapaDe({ etapas, eventosFaltando: [] }, 'checkout')?.total).toBe(20);
  });

  it('as quatro etapas, na ordem do caminho', () => {
    const { etapas } = montarFunil(100, [CARRINHO, CHECKOUT], 5);
    expect(etapas.map((e) => e.id)).toEqual([
      'visitou',
      'carrinho',
      'checkout',
      'comprou',
    ]);
  });

  /*
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ A TELA BUSCA POR `id`, NUNCA POR ÍNDICE.                               │
   * │                                                                        │
   * │ O funil nasceu com três etapas e o carrinho entrou no meio. Quem lesse │
   * │ `etapas[1]` para "chegou no checkout" passaria a ler o CARRINHO sem    │
   * │ erro nenhum aparecer — o número só ficaria maior, e ninguém conferiria │
   * │ porque nada quebrou.                                                   │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  it('etapaDe acha pelo id, e o índice do checkout NÃO é 1', () => {
    const funil = montarFunil(100, [CARRINHO, CHECKOUT], 5);
    expect(etapaDe(funil, 'checkout')?.total).toBe(20);
    expect(funil.etapas[1]?.id).toBe('carrinho');
  });

  it('a fração da etapa anterior é o que diz onde se perde gente', () => {
    const funil = montarFunil(100, [CARRINHO, CHECKOUT], 5);
    expect(etapaDe(funil, 'carrinho')?.daAnterior).toBeCloseTo(0.4);
    expect(etapaDe(funil, 'checkout')?.daAnterior).toBeCloseTo(0.5);
    expect(etapaDe(funil, 'comprou')?.daAnterior).toBeCloseTo(0.25);
  });

  it('o topo não tem etapa anterior, e é 100% dele mesmo', () => {
    const funil = montarFunil(100, [CARRINHO, CHECKOUT], 5);
    expect(etapaDe(funil, 'visitou')?.daAnterior).toBeNull();
    expect(etapaDe(funil, 'visitou')?.doTopo).toBe(1);
  });

  it('tolera as convenções de nome de cada etapa', () => {
    for (const nome of ['addtocart', 'ADD_TO_CART', 'Carrinho']) {
      const funil = montarFunil(100, [evento(nome, 9, 9)], 2);
      expect(etapaDe(funil, 'carrinho')?.total, nome).toBe(9);
      expect(funil.eventosFaltando, nome).not.toContain('AddToCart');
    }
    for (const nome of ['initiatecheckout', 'BEGIN_CHECKOUT', 'Checkout']) {
      const funil = montarFunil(100, [evento(nome, 9, 9)], 2);
      expect(etapaDe(funil, 'checkout')?.total, nome).toBe(9);
    }
  });

  /*
   * O pixel e a gtag podem disparar a MESMA ação com nomes diferentes
   * (`AddToCart` e `add_to_cart`). Somar contaria a pessoa duas vezes, e o
   * meio do funil ficaria maior que o topo.
   */
  it('dois nomes para a mesma ação não somam a mesma pessoa duas vezes', () => {
    const funil = montarFunil(
      100,
      [evento('AddToCart', 50, 40), evento('add_to_cart', 50, 40)],
      5,
    );
    expect(etapaDe(funil, 'carrinho')?.total).toBe(40);
  });

  it('evento que nunca chegou é DESCONHECIDO, não zero', () => {
    const funil = montarFunil(100, [evento('PageView', 300, 100)], 2);
    const carrinho = etapaDe(funil, 'carrinho');

    expect(carrinho?.desconhecido).toBe(true);
    expect(carrinho?.doTopo).toBeNull();
    expect(carrinho?.daAnterior).toBeNull();
    expect(funil.eventosFaltando).toEqual(['AddToCart', 'InitiateCheckout']);
  });

  it('etapa desconhecida apaga a conta da SEGUINTE também', () => {
    // Sem carrinho, "20 de quanto?" não tem resposta medida.
    const funil = montarFunil(100, [CHECKOUT], 2);
    expect(etapaDe(funil, 'checkout')?.daAnterior).toBeNull();
    // Mas a fração do TOPO continua válida: o topo existe.
    expect(etapaDe(funil, 'checkout')?.doTopo).toBeCloseTo(0.2);
  });

  it('zero medido é zero, e não vira desconhecido', () => {
    const funil = montarFunil(100, [evento('AddToCart', 0, 0), CHECKOUT], 0);
    expect(etapaDe(funil, 'carrinho')?.desconhecido).toBe(false);
    expect(etapaDe(funil, 'carrinho')?.doTopo).toBe(0);
  });

  it('sem visitante no topo, nada tem base — e não divide por zero', () => {
    const funil = montarFunil(0, [CARRINHO, CHECKOUT], 0);
    expect(etapaDe(funil, 'carrinho')?.doTopo).toBeNull();
  });
});
