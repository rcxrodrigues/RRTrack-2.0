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
