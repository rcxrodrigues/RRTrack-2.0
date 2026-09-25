import { describe, expect, it } from 'vitest';

import { montarGeometria, tetoRedondo, type Ponto } from './serie';

/**
 * Erro de escala não aparece: a curva continua bonita, só conta outra
 * história. É por isso que a matemática mora fora do componente e tem teste.
 */

function serie(...valores: number[]): Ponto[] {
  return valores.map((valor, i) => ({
    dia: `2026-09-${String(i + 1).padStart(2, '0')}`,
    valor,
  }));
}

describe('tetoRedondo', () => {
  it('sobe para um número que dá rótulo legível', () => {
    expect(tetoRedondo(1387.33)).toBe(1500);
    expect(tetoRedondo(87)).toBe(100);
    expect(tetoRedondo(230)).toBe(250);
    expect(tetoRedondo(6)).toBe(6);
  });

  /*
   * Degrau grosso demais desperdiça o quadro. Com só [1, 2, 2.5, 5, 10],
   * um pico de 5.120 subia para 10.000 e a curva ficava espremida na metade
   * de baixo — parecendo plana num período que dobrou.
   */
  it('não desperdiça metade do quadro', () => {
    expect(tetoRedondo(5120.9)).toBe(6000);
    // O teto nunca passa de 2× o maior valor: acima disso a curva some.
    for (const maior of [1.1, 12, 130, 5120, 7700, 91000]) {
      expect(tetoRedondo(maior) / maior, String(maior)).toBeLessThanOrEqual(2);
    }
  });

  it('as marcas continuam redondas quando dividido por 4', () => {
    for (const maior of [87, 230, 1387, 5120, 91000]) {
      const teto = tetoRedondo(maior);
      // Um quarto do teto não pode dar dízima: o rótulo fica ilegível.
      const quarto = teto / 4;
      expect(Number.isInteger(quarto * 100), String(teto)).toBe(true);
    }
  });

  it('nunca fica abaixo do maior valor — a linha não pode sair do quadro', () => {
    for (const maior of [1, 9, 10, 11, 99, 100, 101, 1999, 2001, 123456]) {
      expect(tetoRedondo(maior), String(maior)).toBeGreaterThanOrEqual(maior);
    }
  });

  it('período sem nada não divide por zero', () => {
    expect(tetoRedondo(0)).toBe(1);
    expect(tetoRedondo(-5)).toBe(1);
  });
});

describe('montarGeometria', () => {
  /*
   * A trava que importa. Cortar a base é a forma mais fácil de mentir com um
   * gráfico: uma variação de 2% vira um pico. Num painel de faturamento isso
   * é decisão de mídia tomada em cima de uma ilusão.
   */
  it('o eixo começa em ZERO, mesmo com os valores todos altos', () => {
    const { marcas, pontos } = montarGeometria(serie(500, 750, 1000), 300, 100);

    expect(marcas[0]?.valor).toBe(0);
    // Teto 1000: 750 fica a três quartos da altura, contados de baixo.
    expect(pontos[1]?.y).toBeCloseTo(25);
    // E o menor NÃO encosta na base: ele vale 500, não zero.
    expect(pontos[0]?.y).toBeCloseTo(50);
  });

  it('o maior valor não encosta no topo do quadro', () => {
    const { pontos } = montarGeometria(serie(0, 1387.33), 300, 100);
    // y = 0 seria a borda. Com teto 1500, 1387 fica logo abaixo dela.
    expect(pontos[1]?.y).toBeGreaterThan(0);
  });

  it('espalha os pontos pela largura inteira', () => {
    const { pontos } = montarGeometria(serie(1, 2, 3, 4, 5), 400, 100);
    expect(pontos[0]?.x).toBe(0);
    expect(pontos.at(-1)?.x).toBe(400);
    expect(pontos[2]?.x).toBe(200);
  });

  it('um ponto só fica no meio, e não divide por zero', () => {
    const { pontos, linha } = montarGeometria(serie(42), 300, 100);
    expect(pontos[0]?.x).toBe(150);
    expect(Number.isFinite(pontos[0]?.y)).toBe(true);
    expect(linha).toMatch(/^M150/);
  });

  it('a área fecha na base, para o preenchimento não vazar', () => {
    const { area } = montarGeometria(serie(10, 20), 300, 100);
    expect(area).toMatch(/L300\.00,100 L0\.00,100 Z$/);
  });

  it('período inteiro em zero não quebra', () => {
    const { pontos, marcas, teto } = montarGeometria(serie(0, 0, 0), 300, 100);
    expect(teto).toBe(1);
    // Todos na base, nenhum NaN.
    for (const p of pontos) expect(p.y).toBe(100);
    expect(marcas.every((m) => Number.isFinite(m.y))).toBe(true);
  });

  it('as marcas vão de zero ao teto, em passos iguais', () => {
    const { marcas } = montarGeometria(serie(100), 300, 100, 4);
    expect(marcas.map((m) => m.valor)).toEqual([0, 25, 50, 75, 100]);
  });

  it('o dia viaja junto do ponto — o tooltip precisa dele', () => {
    const { pontos } = montarGeometria(serie(5, 7), 300, 100);
    expect(pontos[0]?.dia).toBe('2026-09-01');
    expect(pontos[1]?.valor).toBe(7);
  });
});
