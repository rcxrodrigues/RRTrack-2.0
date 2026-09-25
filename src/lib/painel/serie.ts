/**
 * A geometria do gráfico de série temporal.
 *
 * Separada do componente e testada porque erro de escala **não aparece**:
 * a curva continua bonita, só conta outra história. Um eixo que começa
 * acima de zero transforma uma variação de 2% num pico dramático — é o
 * clássico dos gráficos enganosos, e não dá para ver olhando.
 */

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

export function montarGeometria(
  pontos: Ponto[],
  largura: number,
  altura: number,
  marcas = 4,
): Geometria {
  const teto = tetoRedondo(Math.max(...pontos.map((p) => p.valor), 0));

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
