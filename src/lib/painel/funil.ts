import { razao } from '@/lib/formato';

import type { EventoPorTipo } from './consultas';

/**
 * O funil Visitou → Checkout → Comprou.
 *
 * As três etapas contam PESSOAS, não eventos: quem abriu o checkout três
 * vezes é uma pessoa. Contar eventos daria uma etapa do meio maior que o
 * topo, e um funil que engorda no meio não é funil — é um gráfico errado que
 * ninguém sabe ler.
 */

/**
 * Os nomes que valem como "chegou no checkout", em ordem de preferência.
 *
 * `InitiateCheckout` é o evento padrão da Meta e o que o snippet deve
 * disparar. Os outros são tolerância: quem instala pode ter escrito o nome
 * em português ou na convenção do GA4, e um funil vazio por causa de
 * maiúscula seria diagnóstico ruim de um problema trivial.
 */
const NOMES_DE_CHECKOUT = [
  'initiatecheckout',
  'begin_checkout',
  'checkout',
  'iniciarcheckout',
] as const;

export type Etapa = {
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
   * afirmaria que ninguém passou pelo checkout, que é diferente de "eu não
   * sei se alguém passou" — e contradiria o aviso logo abaixo.
   */
  desconhecido: boolean;
};

export type Funil = {
  etapas: Etapa[];
  /**
   * `true` quando nenhum evento de checkout chegou no período.
   *
   * Vale distinguir de "chegou zero": se o snippet não dispara o evento, o
   * funil não tem meio — e mostrar 0% ali culparia a oferta por uma falha de
   * instalação.
   */
  semEventoDeCheckout: boolean;
};

export function montarFunil(
  visitantes: number,
  eventos: EventoPorTipo[],
  compras: number,
): Funil {
  const checkout = eventos.find((e) =>
    (NOMES_DE_CHECKOUT as readonly string[]).includes(e.nome.toLowerCase()),
  );

  const semEventoDeCheckout = checkout === undefined;

  // Pessoas, não eventos — ver a nota no topo.
  const noCheckout = checkout?.visitantes ?? 0;

  const totais = [visitantes, noCheckout, compras];
  const rotulos = ['Visitou', 'Chegou no checkout', 'Comprou'];
  // Só o meio pode ser desconhecido: o topo vem de `visitors` e o fim de
  // `purchases`, e as duas tabelas existem sempre.
  const desconhecidas = [false, semEventoDeCheckout, false];

  const etapas: Etapa[] = totais.map((total, i) => {
    const desconhecido = desconhecidas[i] ?? false;
    // Etapa desconhecida também apaga a conta da SEGUINTE: dividir por um
    // número que não existe daria um percentual que parece medido.
    const anteriorDesconhecida = i > 0 && (desconhecidas[i - 1] ?? false);

    return {
      rotulo: rotulos[i] ?? '',
      total,
      doTopo: desconhecido ? null : razao(total, visitantes),
      daAnterior:
        i === 0 || desconhecido || anteriorDesconhecida
          ? null
          : razao(total, totais[i - 1] ?? 0),
      desconhecido,
    };
  });

  return { etapas, semEventoDeCheckout };
}
