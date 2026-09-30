/**
 * A geometria do gráfico de série temporal.
 *
 * Separada do componente e testada porque erro de escala **não aparece**:
 * a curva continua bonita, só conta outra história. Um eixo que começa
 * acima de zero transforma uma variação de 2% num pico dramático — é o
 * clássico dos gráficos enganosos, e não dá para ver olhando.
 */

/**
 * A altura do quadro, em px — e ela mora AQUI, não no componente.
 *
 * O esqueleto do `Suspense` precisa da mesma altura: diferente, o conteúdo
 * salta quando chega, no componente que existe justamente para nada saltar.
 * Dois `160` em dois arquivos é um número que um dia alguém muda num só.
 */
export const ALTURA_DO_QUADRO = 160;

export type Ponto = {
  /** `YYYY-MM-DD`, já no fuso certo. Texto, nunca `Date`. */
  dia: string;
  valor: number;
};

export type Geometria = {
  /** `d` do `<path>` da linha. */
  linha: string;
  /** `d` do `<path>` da área, fechada na base. */
  area: string;
  /** Pontos em coordenadas de tela, para marcador e alvo de toque. */
  pontos: { x: number; y: number; dia: string; valor: number }[];
  /** Linhas horizontais: valor e posição. */
  marcas: { y: number; valor: number }[];
  /** O maior valor do eixo — o topo da escala, não o do dado. */
  teto: number;
};

/**
 * Um teto "redondo" acima do maior valor.
 *
 * Sem isto, a linha encosta na borda de cima e parece cortada; e com um teto
 * qualquer, os rótulos do eixo saem quebrados (R$ 1.387,33) onde deviam ser
 * legíveis (R$ 1.500,00).
 */
export function tetoRedondo(maior: number): number {
  if (maior <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(maior));
  /*
   * Degraus finos o bastante para não desperdiçar o quadro.
   *
   * Com só [1, 2, 2.5, 5, 10], um pico de 5.120 subia para 10.000 e a curva
   * ficava espremida na metade de baixo — parecendo plana num período que
   * dobrou. Com 6 no conjunto, ele sobe para 6.000 e a forma aparece.
   *
   * Todos produzem rótulo redondo quando divididos por 4, que é o número de
   * marcas: 6.000/4 = 1.500, 1.500/4 = 375… os que quebravam ficaram fora.
   */
  for (const passo of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const candidato = passo * magnitude;
    if (candidato >= maior) return candidato;
  }
  return 10 * magnitude;
}

/**
 * O teto que DUAS séries dividem.
 *
 * Quando receita e gasto vão no mesmo quadro, o eixo tem de ser um só — é a
 * regra mais importante de gráfico com duas medidas, e vale aqui porque as
 * duas são a MESMA unidade (reais). Com um eixo cada, o vão entre as linhas
 * deixaria de significar lucro e o cruzamento deixaria de ser o ponto de
 * equilíbrio: seriam duas curvas bonitas dizendo nada.
 *
 * Cada série calculando o próprio teto daria exatamente isso, por dentro,
 * sem parecer um eixo duplo.
 */
export function tetoComum(...listas: Ponto[][]): number {
  const valores = listas.flat().map((p) => p.valor);
  return tetoRedondo(Math.max(...valores, 0));
}

export function montarGeometria(
  pontos: Ponto[],
  largura: number,
  altura: number,
  marcas = 4,
  /** O teto de fora, quando outra série divide o mesmo eixo. */
  tetoCompartilhado?: number,
): Geometria {
  const teto =
    tetoCompartilhado ?? tetoRedondo(Math.max(...pontos.map((p) => p.valor), 0));

  /*
   * O eixo SEMPRE começa em zero.
   *
   * Cortar a base é a forma mais fácil de mentir com um gráfico: uma
   * variação de 2% vira um pico. Num painel de faturamento isso não é
   * estética — é decisão de mídia tomada em cima de uma ilusão.
   */
  const emY = (valor: number): number =>
    altura - (teto === 0 ? 0 : (valor / teto) * altura);

  // Um ponto só não tem "entre": fica no meio, em vez de dividir por zero.
  const passoX = pontos.length > 1 ? largura / (pontos.length - 1) : 0;
  const emX = (i: number): number =>
    pontos.length > 1 ? i * passoX : largura / 2;

  const coordenadas = pontos.map((p, i) => ({
    x: emX(i),
    y: emY(p.valor),
    dia: p.dia,
    valor: p.valor,
  }));

  const linha = coordenadas
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(' ');

  const primeiro = coordenadas[0];
  const ultimo = coordenadas.at(-1);
  const area =
    primeiro && ultimo
      ? `${linha} L${ultimo.x.toFixed(2)},${altura} L${primeiro.x.toFixed(2)},${altura} Z`
      : '';

  return {
    linha,
    area,
    pontos: coordenadas,
    marcas: Array.from({ length: marcas + 1 }, (_, i) => {
      const valor = (teto / marcas) * i;
      return { y: emY(valor), valor };
    }),
    teto,
  };
}

/**
 * Casa uma série esparsa nos dias de outra — por DATA, nunca por posição.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A META OMITE O DIA SEM GASTO. A RECEITA, NÃO.                            │
 * │                                                                          │
 * │ `painel_serie_diaria` devolve os dias vazios de propósito (é o que       │
 * │ impede a curva de pular o dia sem venda). O `time_increment=1` da Meta   │
 * │ faz o contrário: dia sem anúncio simplesmente não vem na lista.          │
 * │                                                                          │
 * │ Juntar as duas por índice — `gasto[i]` ao lado de `receita[i]` — parece  │
 * │ funcionar num período cheio e DESLOCA a curva inteira no primeiro dia    │
 * │ sem gasto: o investido de quarta aparece sob a receita de terça, e daí   │
 * │ para a frente tudo anda um dia. Nada quebra, nenhum número fica          │
 * │ estranho, e o quadro passa a mentir sobre qual dia pagou qual venda.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O eixo é a lista de dias de quem TEM todos eles. Dia ausente na esparsa
 * vira zero — e zero aqui é medida de verdade, não "não sei": a conta de
 * anúncio existe e não rodou naquele dia. Quando o gasto é *desconhecido*
 * (nenhuma conta cadastrada, ou a Meta fora do ar), quem decide é a tela, que
 * não desenha a série nenhuma — desenhar uma linha reta no zero afirmaria que
 * não se gastou nada.
 */
export function alinharPorDia(
  dias: string[],
  esparsa: { dia: string; valor: number }[],
): Ponto[] {
  const porDia = new Map<string, number>();
  for (const p of esparsa) {
    // Somado, não sobrescrito: várias contas de anúncio caem no mesmo dia.
    porDia.set(p.dia, (porDia.get(p.dia) ?? 0) + p.valor);
  }

  return dias.map((dia) => ({ dia, valor: porDia.get(dia) ?? 0 }));
}

// ---------------------------------------------------------------------------
// As séries do quadro de receita × investido
// ---------------------------------------------------------------------------

/**
 * As cores que uma série pode ter, por NOME.
 *
 * A união mora aqui, no arquivo puro, e o mapa de classes do Tailwind mora no
 * componente tipado como `Record<CorDaSerie, …>` — então acrescentar um nome
 * aqui sem acrescentar a classe lá é erro de compilação, não uma linha
 * invisível na tela.
 */
export type CorDaSerie = 'azul' | 'teal' | 'ambar';

export type SerieDoQuadro = {
  id: string;
  /** O que a linha é — vai na legenda e no tooltip. */
  rotulo: string;
  cor: CorDaSerie;
  pontos: Ponto[];
};

/**
 * Monta as séries do quadro da visão geral.
 *
 * Mora aqui, e não dentro do Server Component, porque a regra abaixo é a que
 * mais custa se quebrar e teste não alcança componente de servidor.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ GASTO DESCONHECIDO NÃO VIRA LINHA NO ZERO.                               │
 * │                                                                          │
 * │ `null` é "não sei": nenhuma conta de anúncio cadastrada, ou a Meta fora  │
 * │ do ar sem nada no cache. Alinhar isso daria uma lista de zeros — e uma   │
 * │ reta colada na base, atravessando o período inteiro, AFIRMA que não se   │
 * │ gastou nada, com a mesma convicção com que a outra linha diz quanto      │
 * │ entrou. É a regra do travessão (`—`, nunca `0`) na forma mais perigosa   │
 * │ dela, porque aqui quem afirma não é um número: é o desenho.              │
 * │                                                                          │
 * │ Lista VAZIA é o contrário: a conta existe, a Meta respondeu, e não se    │
 * │ gastou. Esse zero é medida e aparece.                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function montarSeriesDoQuadro(
  receitaPorDia: { dia: string; receita: number }[],
  gastoPorDia: { dia: string; valor: number }[] | null,
): SerieDoQuadro[] {
  const series: SerieDoQuadro[] = [
    {
      id: 'receita',
      rotulo: 'receita',
      cor: 'teal',
      pontos: receitaPorDia.map((p) => ({ dia: p.dia, valor: p.receita })),
    },
  ];

  if (gastoPorDia !== null) {
    series.push({
      id: 'gasto',
      rotulo: 'investido',
      cor: 'ambar',
      pontos: alinharPorDia(
        receitaPorDia.map((p) => p.dia),
        gastoPorDia,
      ),
    });
  }

  return series;
}
