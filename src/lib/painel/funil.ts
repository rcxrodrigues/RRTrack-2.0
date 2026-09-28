import { razao } from '@/lib/formato';

import type { EventoPorTipo } from './consultas';

/**
 * O funil Visitou → Carrinho → Checkout → Comprou.
 *
 * As etapas contam PESSOAS, não eventos: quem abriu o checkout três vezes é
 * uma pessoa. Contar eventos daria uma etapa do meio maior que o topo, e um
 * funil que engorda no meio não é funil — é um gráfico errado que ninguém
 * sabe ler.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CADA ETAPA TEM `id`, E A TELA BUSCA POR ELE — NUNCA POR ÍNDICE.          │
 * │                                                                          │
 * │ O funil nasceu com três etapas e o carrinho entrou no meio. Quem lesse   │
 * │ `etapas[1]` para "chegou no checkout" passaria a ler o CARRINHO, sem     │
 * │ erro nenhum aparecer: o número simplesmente ficaria maior, e ninguém     │
 * │ conferiria porque nada quebrou.                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type IdEtapa = 'visitou' | 'carrinho' | 'checkout' | 'comprou';

/**
 * Os nomes que valem para cada etapa, em ordem de preferência.
 *
 * O primeiro de cada lista é o evento padrão da Meta, e é o que o snippet
 * deve disparar. Os outros são tolerância: quem instala pode ter escrito o
 * nome na convenção do GA4 ou em português, e um funil vazio por causa de
 * maiúscula seria diagnóstico ruim de um problema trivial.
 */
const NOMES: Record<'carrinho' | 'checkout', readonly string[]> = {
  carrinho: ['addtocart', 'add_to_cart', 'adicionaraocarrinho', 'carrinho'],
  checkout: ['initiatecheckout', 'begin_checkout', 'checkout', 'iniciarcheckout'],
};

export type Etapa = {
  id: IdEtapa;
  rotulo: string;
  total: number;
  /** Fração do TOPO do funil. `null` quando não dá para calcular. */
  doTopo: number | null;
  /** Fração da etapa ANTERIOR — é esta que diz onde se perde gente. */
  daAnterior: number | null;
  /**
   * O dado desta etapa não existe — não é zero.
   *
   * Acontece quando o evento que a alimenta nunca chegou. A distinção é a
   * regra do projeto: zero é um número, "sem dado" não é. Mostrar 0% aqui
   * afirmaria que ninguém passou pelo carrinho, que é diferente de "eu não
   * sei se alguém passou" — e contradiria o aviso logo abaixo.
   */
  desconhecido: boolean;
};

export type Funil = {
  etapas: Etapa[];
  /**
   * As etapas do meio cujo evento não chegou, pelo nome do evento esperado.
   *
   * Vale distinguir de "chegou zero": se o snippet não dispara o evento, o
   * funil não tem aquele degrau — e mostrar 0% ali culparia a oferta por uma
   * falha de instalação.
   */
  eventosFaltando: string[];
};

/** Quantas PESSOAS dispararam algum dos nomes daquela etapa. */
function pessoasEm(eventos: EventoPorTipo[], nomes: readonly string[]): number | null {
  const achados = eventos.filter((e) => nomes.includes(e.nome.toLowerCase()));
  if (achados.length === 0) return null;
  /*
   * O MAIOR, não a soma.
   *
   * Uma loja que dispara `AddToCart` e `add_to_cart` ao mesmo tempo (o pixel
   * e a gtag, cada um com sua convenção) somaria a mesma pessoa duas vezes e
   * o meio do funil ficaria maior que o topo. O maior é o mais próximo da
   * verdade sem poder cruzar visitante por visitante aqui.
   */
  return Math.max(...achados.map((e) => e.visitantes));
}

export function montarFunil(
  visitantes: number,
  eventos: EventoPorTipo[],
  compras: number,
): Funil {
  const carrinho = pessoasEm(eventos, NOMES.carrinho);
  const checkout = pessoasEm(eventos, NOMES.checkout);

  const cru: { id: IdEtapa; rotulo: string; total: number | null }[] = [
    { id: 'visitou', rotulo: 'Visitou', total: visitantes },
    { id: 'carrinho', rotulo: 'Adicionou ao carrinho', total: carrinho },
    { id: 'checkout', rotulo: 'Chegou no checkout', total: checkout },
    { id: 'comprou', rotulo: 'Comprou', total: compras },
  ];

  const etapas: Etapa[] = cru.map((e, i) => {
    const desconhecido = e.total === null;
    /*
     * Etapa desconhecida apaga a conta da SEGUINTE também: dividir por um
     * número que não existe daria um percentual que parece medido.
     */
    const anteriorDesconhecida = i > 0 && cru[i - 1]?.total === null;
    const anterior = cru[i - 1]?.total ?? 0;

    return {
      id: e.id,
      rotulo: e.rotulo,
      total: e.total ?? 0,
      doTopo: desconhecido ? null : razao(e.total ?? 0, visitantes),
      daAnterior:
        i === 0 || desconhecido || anteriorDesconhecida
          ? null
          : razao(e.total ?? 0, anterior),
      desconhecido,
    };
  });

  const eventosFaltando: string[] = [];
  if (carrinho === null) eventosFaltando.push('AddToCart');
  if (checkout === null) eventosFaltando.push('InitiateCheckout');

  return { etapas, eventosFaltando };
}

/** A etapa pelo `id` — nunca por índice. Ver o aviso no topo. */
export function etapaDe(funil: Funil, id: IdEtapa): Etapa | undefined {
  return funil.etapas.find((e) => e.id === id);
}

/**
 * Piso visível: abaixo disto a faixa some e "quase ninguém" vira "ninguém".
 *
 * Vale para etapa com gente de verdade, e SÓ para ela — ver `largurasDoFunil`.
 */
export const PISO = 9;

/**
 * A largura de cada etapa no desenho, em porcentagem do topo.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS ESTADOS, E O PISO VALE PARA UM SÓ.                                  │
 * │                                                                          │
 * │   total > 0       largura proporcional, com PISO para não sumir          │
 * │   total === 0     largura ZERO: o funil fecha num ponto                  │
 * │   desconhecido    sem medida: interpola entre os vizinhos, e o tracejado │
 * │                   é que diz que ali não se sabe                          │
 * │                                                                          │
 * │ O defeito que isto conserta: o piso era aplicado ao zero também. Numa    │
 * │ conta com 6 visitantes e NENHUMA compra, a etapa "Comprou" ganhava 9% de │
 * │ largura e virava uma barra sólida embaixo do funil — uma compra          │
 * │ fantasma, desenhada. Foi a captura de tela que pegou, e é a regra do     │
 * │ projeto quebrada no desenho: zero é medida, e a medida do zero é NADA.   │
 * │                                                                          │
 * │ Um piso no zero também mente sobre a proporção, que é o que a forma      │
 * │ existe para mostrar: 0 de 6 desenhado igual a 1 de 6.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A interpolação do desconhecido é LINEAR ao longo do trecho, não a média dos
 * dois extremos: com duas etapas sem medida seguidas — que é o caso comum,
 * carrinho e checkout juntos —, a média daria a mesma largura para as duas e
 * o trecho viraria um bloco reto no meio de um funil.
 */
export function largurasDoFunil(etapas: readonly Etapa[]): number[] {
  const topo = etapas[0]?.total ?? 0;

  /** A largura medida, ou `null` quando não há medida. */
  const medidas = etapas.map((e): number | null => {
    if (e.desconhecido || topo <= 0) return null;
    if (e.total === 0) return 0;
    return Math.max(PISO, Math.min(100, (e.total / topo) * 100));
  });

  return medidas.map((largura, i) => {
    if (largura !== null) return largura;

    // O último conhecido antes, e o primeiro conhecido depois.
    let a = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (medidas[k] !== null) { a = k; break; }
    }
    let b = -1;
    for (let k = i + 1; k < medidas.length; k++) {
      if (medidas[k] !== null) { b = k; break; }
    }

    const larguraA = a === -1 ? 100 : (medidas[a] ?? 100);
    // Sem nada conhecido depois, o trecho segue reto: inventar um
    // estreitamento seria afirmar uma queda que ninguém mediu.
    if (b === -1) return larguraA;

    const larguraB = medidas[b] ?? 0;
    const inicio = a === -1 ? 0 : a;
    return larguraA + ((larguraB - larguraA) * (i - inicio)) / (b - inicio);
  });
}
