import { describe, expect, it } from 'vitest';

import { montarFunil } from './funil';
import type { EventoPorTipo } from './consultas';

function evento(nome: string, total: number, visitantes: number): EventoPorTipo {
  return { nome, total, visitantes };
}

describe('montarFunil', () => {
  it('conta PESSOAS na etapa do meio, não eventos', () => {
    /*
     * Cem visitantes abriram o checkout, e alguns voltaram: 250 eventos, 100
     * pessoas. Usar o total daria uma etapa do meio MAIOR que o topo — um
     * funil que engorda no meio não é funil, é gráfico errado.
     */
    const { etapas } = montarFunil(
      1000,
      [evento('InitiateCheckout', 250, 100)],
      13,
    );

    expect(etapas[1]?.total).toBe(100);
    expect(etapas[1]?.doTopo).toBeCloseTo(0.1);
  });

  it('a conversão de cada etapa é sobre a ANTERIOR', () => {
    const { etapas } = montarFunil(1000, [evento('InitiateCheckout', 200, 200)], 40);

    // É este número que diz onde se perde gente: 20% chegaram ao checkout,
    // e desses 20% compraram.
    expect(etapas[1]?.daAnterior).toBeCloseTo(0.2);
    expect(etapas[2]?.daAnterior).toBeCloseTo(0.2);
    // E o do topo é outro: 4% dos visitantes compraram.
    expect(etapas[2]?.doTopo).toBeCloseTo(0.04);
  });

  it('o topo não tem "anterior"', () => {
    const { etapas } = montarFunil(10, [], 1);
    expect(etapas[0]?.daAnterior).toBeNull();
    expect(etapas[0]?.doTopo).toBe(1);
  });

  it('aceita o nome do evento em qualquer caixa e nas convenções conhecidas', () => {
    for (const nome of ['InitiateCheckout', 'initiatecheckout', 'begin_checkout', 'Checkout']) {
      const { etapas, semEventoDeCheckout } = montarFunil(100, [evento(nome, 9, 9)], 2);
      expect(semEventoDeCheckout, nome).toBe(false);
      expect(etapas[1]?.total, nome).toBe(9);
    }
  });

  /*
   * A distinção que evita culpar a oferta por falha de instalação: se o
   * snippet não dispara o evento de checkout, o funil não TEM meio. Mostrar
   * 0% ali diria que ninguém chegou ao checkout, o que é diferente de "eu
   * não sei se alguém chegou".
   */
  it('avisa quando nenhum evento de checkout chegou', () => {
    const { semEventoDeCheckout } = montarFunil(100, [evento('PageView', 300, 100)], 2);
    expect(semEventoDeCheckout).toBe(true);
  });

  /*
   * A regra do projeto: `—`, nunca `0`. Aqui ela é o que impede o painel de
   * AFIRMAR que ninguém chegou ao checkout quando o que não chegou foi o
   * evento — e de contradizer, com um número, o aviso logo abaixo dele.
   */
  it('a etapa sem evento fica DESCONHECIDA, não zerada', () => {
    const { etapas } = montarFunil(100, [evento('PageView', 300, 100)], 2);

    expect(etapas[1]?.desconhecido).toBe(true);
    expect(etapas[1]?.doTopo).toBeNull();
    expect(etapas[1]?.daAnterior).toBeNull();
  });

  it('e apaga a conta da etapa SEGUINTE também', () => {
    // Dividir por um número que não existe daria um percentual com cara de
    // medido. A venda continua contada; o que some é a comparação.
    const { etapas } = montarFunil(100, [evento('PageView', 300, 100)], 2);

    expect(etapas[2]?.total).toBe(2);
    expect(etapas[2]?.daAnterior).toBeNull();
    // O do topo continua valendo: esse não passa pelo meio.
    expect(etapas[2]?.doTopo).toBeCloseTo(0.02);
  });

  it('com o evento presente, nenhuma etapa é desconhecida', () => {
    const { etapas } = montarFunil(100, [evento('InitiateCheckout', 9, 9)], 2);
    expect(etapas.map((e) => e.desconhecido)).toEqual([false, false, false]);
  });

  it('checkout que existe e deu ZERO é zero mesmo, não desconhecido', () => {
    // O evento chegou no período, só que nenhuma pessoa distinta bateu o
    // filtro. Aí 0% é a resposta certa, e dizer "—" esconderia um problema
    // real da oferta.
    const { etapas } = montarFunil(100, [evento('InitiateCheckout', 0, 0)], 0);

    expect(etapas[1]?.desconhecido).toBe(false);
    expect(etapas[1]?.doTopo).toBe(0);
  });

  it('período sem visitante nenhum devolve null, não zero', () => {
    const { etapas } = montarFunil(0, [], 0);
    for (const etapa of etapas) {
      expect(etapa.doTopo).toBeNull();
    }
    // E não divide por zero na cascata.
    expect(etapas[1]?.daAnterior).toBeNull();
  });

  it('venda sem visitante casado não estoura a conta', () => {
    // A venda órfã existe: chegou pelo webhook e não casou com ninguém.
    // A etapa pode passar de 100% do topo, e isso é informação, não bug.
    const { etapas } = montarFunil(1, [], 5);
    expect(etapas[2]?.doTopo).toBe(5);
  });
});
