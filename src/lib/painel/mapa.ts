import { ESTADOS_BRASIL, ufDaRegiao, type EstadoDoMapa } from './mapa-brasil';
import type { NoGeo } from './geo-arvore';

/**
 * O que pintar em cada estado do mapa.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O MAPA NÃO É UM SEGUNDO JEITO DE LER OS MESMOS NÚMEROS.                  │
 * │                                                                          │
 * │ Comparar dois tons de azul continua sendo o pior jeito de comparar dois  │
 * │ números, e a árvore ao lado continua sendo quem responde "quanto". O     │
 * │ mapa responde outra coisa, que a árvore NÃO responde: **onde não tem     │
 * │ nada**. A árvore lista quem apareceu; quem não apareceu não tem linha,   │
 * │ e um estado sem nenhum visitante é invisível nela. No mapa ele é um      │
 * │ buraco, e buraco se vê de relance.                                       │
 * │                                                                          │
 * │ E ele é um ÍNDICE: tocar num estado abre aquele estado na árvore. É o    │
 * │ que faz os dois serem um par em vez de dois desenhos competindo.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Por isso a origem dos números é a PRÓPRIA árvore, e não uma consulta
 * paralela: dois caminhos para o mesmo total é garantir que um dia eles
 * discordam — e aqui a discordância apareceria como um estado pintado de
 * forte ao lado de uma linha dizendo outro número.
 */

/**
 * As faixas, e as três primeiras não são degraus da mesma escala.
 *
 * `vazio` é ausência de medida — ninguém daquele estado chegou ao site.
 * `trafego` é medida: chegou gente e não comprou ninguém. Pintar os dois
 * igual é a regra do travessão quebrada num mapa, e é o erro que quase todo
 * mapa de painel comete: o estado que você nunca alcançou fica com a mesma
 * cor do estado onde sua oferta não converte, que são problemas OPOSTOS —
 * um pede mídia, o outro pede investigar por que não vende.
 */
export type FaixaDoMapa = 'vazio' | 'trafego' | 'r1' | 'r2' | 'r3' | 'r4';

export type EstadoPintado = EstadoDoMapa & {
  visitantes: number;
  aprovadas: number;
  receita: number;
  faixa: FaixaDoMapa;
};

/**
 * Em que faixa de receita um valor cai, dado o maior do período.
 *
 * Quatro degraus lineares sobre a fração do MAIOR estado. Linear, e não uma
 * curva que "melhora" a distribuição: num funil brasileiro São Paulo domina,
 * e uma escala que levanta o meio faria o Acre parecer parente do Sudeste.
 * O mapa mostra a forma do país; quem dá o número exato é a árvore ao lado
 * e o rótulo ao tocar.
 */
export function faixaDaReceita(receita: number, maior: number): FaixaDoMapa {
  if (receita <= 0) return 'trafego';
  if (maior <= 0) return 'trafego';

  const fracao = receita / maior;
  if (fracao > 0.75) return 'r4';
  if (fracao > 0.5) return 'r3';
  if (fracao > 0.25) return 'r2';
  return 'r1';
}

/**
 * Casa os estados do desenho com os números da árvore.
 *
 * Devolve **os 27 sempre**, na ordem do desenho — inclusive os que não
 * aparecem na árvore, que são justamente os que o mapa existe para mostrar.
 */
export function pintarMapa(raizes: readonly NoGeo[]): EstadoPintado[] {
  // O nó do Brasil, por chave. País que não é o Brasil não entra neste mapa
  // — e não some do painel: a árvore ao lado continua listando todos.
  const brasil = raizes.find((r) => r.chave === 'BR');

  const porUf = new Map<string, NoGeo>();
  for (const filho of brasil?.filhos ?? []) {
    // O país é `BR` por construção: `brasil` é o nó de chave `BR` e estes
    // são os filhos DELE. Dito mesmo assim, porque a sigla crua é ambígua e
    // `ufDaRegiao` recusa quem não declarar — ver a colisão PA/Pensilvânia.
    const uf = ufDaRegiao(filho.chave, 'BR');
    // `Não informado` (região nula) não tem onde ser pintado — continua na
    // árvore, que é onde ele pode aparecer com nome.
    if (uf) porUf.set(uf, filho);
  }

  const maior = Math.max(0, ...[...porUf.values()].map((n) => n.receita));

  return ESTADOS_BRASIL.map((estado) => {
    const no = porUf.get(estado.uf);

    if (!no || no.visitantes === 0) {
      /*
       * Sem visitante nenhum → `vazio`, mesmo que por algum caminho houvesse
       * receita. Não é defensividade à toa: uma venda órfã casada por e-mail
       * pode trazer geo sem ter passado por visita, e pintar isso como
       * tráfego afirmaria um alcance que não houve.
       */
      return {
        uf: estado.uf,
        nome: estado.nome,
        cx: estado.cx,
        cy: estado.cy,
        d: estado.d,
        visitantes: no?.visitantes ?? 0,
        aprovadas: no?.aprovadas ?? 0,
        receita: no?.receita ?? 0,
        faixa: 'vazio' as const,
      };
    }

    return {
      uf: estado.uf,
      nome: estado.nome,
      cx: estado.cx,
      cy: estado.cy,
      d: estado.d,
      visitantes: no.visitantes,
      aprovadas: no.aprovadas,
      receita: no.receita,
      faixa: faixaDaReceita(no.receita, maior),
    };
  });
}

/** Quantos estados nunca receberam ninguém — o número que o mapa existe para dar. */
export function estadosSemAlcance(pintados: readonly EstadoPintado[]): number {
  return pintados.filter((e) => e.faixa === 'vazio').length;
}
