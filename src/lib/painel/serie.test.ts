import { describe, expect, it } from 'vitest';

import {
  alinharPorDia,
  montarGeometria,
  montarSeriesDoQuadro,
  tetoComum,
  tetoRedondo,
  type Ponto,
} from './serie';

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

// ---------------------------------------------------------------------------
// Duas séries no mesmo quadro
// ---------------------------------------------------------------------------

describe('alinharPorDia', () => {
  const dias = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

  /*
   * O DEFEITO QUE ESTE TESTE EXISTE PARA PEGAR.
   *
   * A Meta omite o dia sem gasto; o nosso banco devolve todos. Juntar as
   * duas por índice — `gasto[i]` sob `receita[i]` — funciona num período
   * cheio e DESLOCA a curva inteira a partir do primeiro dia vazio: o
   * investido de quinta aparece sob a receita de quarta, e daí para frente
   * tudo anda um dia.
   *
   * Nada quebra, nenhum número fica estranho, e o quadro passa a mentir
   * sobre qual dia pagou qual venda — que é a única pergunta que ele
   * responde.
   */
  it('o dia que falta vira zero, e não desloca os outros', () => {
    const alinhado = alinharPorDia(dias, [
      { dia: '2026-09-01', valor: 10 },
      // 02 não veio: não se gastou nada naquele dia.
      { dia: '2026-09-03', valor: 30 },
      { dia: '2026-09-04', valor: 40 },
    ]);

    expect(alinhado).toEqual([
      { dia: '2026-09-01', valor: 10 },
      { dia: '2026-09-02', valor: 0 },
      { dia: '2026-09-03', valor: 30 },
      { dia: '2026-09-04', valor: 40 },
    ]);
  });

  it('soma o mesmo dia de contas de anúncio diferentes', () => {
    // Duas contas ativas caem no mesmo dia; sobrescrever perderia uma delas
    // e o investido apareceria menor do que foi — inflando o ROAS ao lado.
    const alinhado = alinharPorDia(['2026-09-01'], [
      { dia: '2026-09-01', valor: 10 },
      { dia: '2026-09-01', valor: 25 },
    ]);

    expect(alinhado).toEqual([{ dia: '2026-09-01', valor: 35 }]);
  });

  it('não inventa dia fora do eixo', () => {
    // A conversão do `ate` inclusivo da Meta pode devolver um dia a mais.
    // Ele não entra: o eixo é o do período que a tela está mostrando.
    const alinhado = alinharPorDia(['2026-09-01'], [
      { dia: '2026-09-01', valor: 10 },
      { dia: '2026-09-02', valor: 99 },
    ]);

    expect(alinhado).toEqual([{ dia: '2026-09-01', valor: 10 }]);
  });

  it('sem nenhum gasto, devolve o eixo inteiro em zero', () => {
    // Vazio aqui é "a conta existe e não rodou" — quem decide se isso vira
    // linha é `montarSeriesDoQuadro`, e a resposta dele muda com o `null`.
    expect(alinharPorDia(dias, [])).toEqual(
      dias.map((dia) => ({ dia, valor: 0 })),
    );
  });
});

describe('tetoComum — o eixo único', () => {
  it('cobre a maior das duas séries, venha ela de qual vier', () => {
    // Nas DUAS ordens de propósito: com o maior sempre na segunda lista,
    // um `tetoComum` que olhasse só uma delas passaria no teste e cortaria
    // a outra curva pela borda de cima na tela.
    expect(tetoComum(serie(10, 20), serie(500, 30))).toBe(tetoRedondo(500));
    expect(tetoComum(serie(500, 30), serie(10, 20))).toBe(tetoRedondo(500));
    // Série vazia no meio não zera o eixo: o quadro pode ter só uma linha.
    expect(tetoComum([], serie(500))).toBe(tetoRedondo(500));
  });

  /*
   * A PROPRIEDADE QUE UM EIXO DUPLO QUEBRARIA.
   *
   * Receita e investido são a MESMA unidade, então R$ 100 numa linha tem de
   * ficar na MESMA altura que R$ 100 na outra. É isso — e só isso — que faz
   * o vão entre as linhas ser a margem sobre a mídia e o cruzamento ser o
   * ponto de equilíbrio.
   *
   * Com cada série calculando o próprio teto (que é o eixo duplo por
   * dentro, sem parecer um), as duas encostam no topo do quadro e o
   * cruzamento passa a acontecer onde o desenho quiser.
   */
  it('valor igual fica na MESMA altura nas duas séries', () => {
    const receita = serie(100, 900);
    const gasto = serie(100, 200);
    const teto = tetoComum(receita, gasto);

    const gr = montarGeometria(receita, 600, 160, 4, teto);
    const gg = montarGeometria(gasto, 600, 160, 4, teto);

    expect(gg.pontos[0]?.y).toBe(gr.pontos[0]?.y);

    // E a prova de que o teste tem dente: sem o teto compartilhado, os
    // mesmos R$ 100 caem em alturas diferentes — a segunda linha subiria
    // como se valesse quatro vezes mais.
    const sozinha = montarGeometria(gasto, 600, 160);
    expect(sozinha.pontos[0]?.y).not.toBe(gr.pontos[0]?.y);
  });

  it('as marcas do eixo são as mesmas para as duas — a calha vale para ambas', () => {
    const teto = tetoComum(serie(100, 900), serie(100, 200));
    const a = montarGeometria(serie(100, 900), 600, 160, 4, teto);
    const b = montarGeometria(serie(100, 200), 600, 160, 4, teto);

    expect(b.marcas).toEqual(a.marcas);
  });
});

describe('montarSeriesDoQuadro', () => {
  const receita = [
    { dia: '2026-09-01', receita: 100 },
    { dia: '2026-09-02', receita: 250 },
  ];

  /*
   * A REGRA MAIS CARA DESTE QUADRO.
   *
   * `null` é "não sei": nenhuma conta de anúncio cadastrada, ou a Meta fora
   * do ar sem nada no cache. Uma reta colada no zero atravessando o período
   * AFIRMA que não se gastou nada — com a mesma convicção com que a outra
   * linha diz quanto entrou. É a regra do travessão (`—`, nunca `0`) na
   * forma mais perigosa dela: aqui quem afirma não é um número, é o desenho,
   * e ninguém confere o desenho.
   */
  it('gasto DESCONHECIDO não vira linha nenhuma', () => {
    const series = montarSeriesDoQuadro(receita, null);

    expect(series).toHaveLength(1);
    expect(series[0]?.id).toBe('receita');
  });

  it('gasto conhecido e ZERO vira linha, porque zero aí é medida', () => {
    // A conta existe, a Meta respondeu, e não se gastou: R$ 0,00 é verdade.
    const series = montarSeriesDoQuadro(receita, []);

    expect(series).toHaveLength(2);
    expect(series[1]?.pontos).toEqual([
      { dia: '2026-09-01', valor: 0 },
      { dia: '2026-09-02', valor: 0 },
    ]);
  });

  it('o investido segue os dias da receita, não a lista da Meta', () => {
    const series = montarSeriesDoQuadro(receita, [
      { dia: '2026-09-02', valor: 40 },
    ]);

    expect(series[1]?.pontos).toEqual([
      { dia: '2026-09-01', valor: 0 },
      { dia: '2026-09-02', valor: 40 },
    ]);
  });

  it('as duas séries têm cores e rótulos distintos', () => {
    const series = montarSeriesDoQuadro(receita, []);

    expect(series.map((s) => s.rotulo)).toEqual(['receita', 'investido']);
    // Mesma cor nas duas seria uma legenda que não separa nada.
    expect(series[0]?.cor).not.toBe(series[1]?.cor);
  });
});
