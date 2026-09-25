import type { LinhaInsights } from '@/lib/meta/insights';
import type { ReceitaPorUtmCompleta } from '@/lib/painel/consultas';
import { cruzar, type LinhaDeRoas } from '@/lib/painel/roas';

/**
 * A árvore campanha → conjunto → anúncio, como no gerenciador da Meta.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CADA NÍVEL CASA COM A SUA PRÓPRIA UTM, e não com a da campanha.          │
 * │                                                                          │
 * │ A convenção das macros põe `{{adset.name}}` em `utm_term` e              │
 * │ `{{ad.name}}` em `utm_content`. Casar tudo por `utm_campaign` daria a    │
 * │ receita INTEIRA da campanha a cada conjunto dela — e a soma dos filhos   │
 * │ seria várias vezes o pai, num painel que existe para fechar com o caixa. │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Onde a macro não estiver no anúncio, o campo chega vazio e o nível fica sem
 * receita casada: `—`, nunca `0.00×`. Ver `motivoSemRoas` em `roas.ts`.
 */

export type NoDaArvore = LinhaDeRoas & {
  filhos: NoDaArvore[];
  /** 0 campanha, 1 conjunto, 2 anúncio — para o recuo na tela. */
  nivel: number;
};

export type Arvore = {
  raizes: NoDaArvore[];
  receitaOrfa: number;
  vendasOrfas: number;
  utmsSemPar: string[];
};

/** A receita reduzida ao campo que aquele nível usa para casar. */
function porCampo(
  receitas: ReceitaPorUtmCompleta[],
  campo: 'campanha' | 'conjunto' | 'anuncio',
): { campanha: string; origem: string; vendas: number; receita: number }[] {
  const soma = new Map<string, { vendas: number; receita: number; origem: string }>();

  /*
   * A receita SEM a chave daquele nível vira ÓRFÃ, não desaparece.
   *
   * Descartá-la era o erro: `cruzar` passava a ver um período sem receita
   * nenhuma, e um anúncio que gastou aparecia com `0.00×` VERMELHO — quando
   * a venda existiu e o que faltou foi a macro `{{ad.name}}` no anúncio.
   * Como órfã (chave vazia), `cruzar` reconhece que houve venda e devolve
   * `—` com `sem-casamento`, que é o diagnóstico certo.
   *
   * E continua não virando grupo: chave vazia não cria nó, então não existe
   * anúncio fantasma juntando a receita de todos os que não têm macro.
   */
  for (const r of receitas) {
    const chave = r[campo];
    const atual = soma.get(chave) ?? { vendas: 0, receita: 0, origem: r.origem };
    soma.set(chave, {
      vendas: atual.vendas + r.vendas,
      receita: atual.receita + r.receita,
      origem: atual.origem,
    });
  }

  return [...soma.entries()].map(([campanha, v]) => ({
    campanha,
    origem: v.origem,
    vendas: v.vendas,
    receita: v.receita,
  }));
}

/** Uma linha de ROAS vira nó da árvore, sem filhos ainda. */
function comoNo(l: LinhaDeRoas, nivel: number): NoDaArvore {
  return { ...l, nivel, filhos: [] };
}

/** Maior gasto primeiro, em todo nível: é por onde o olho começa. */
function ordenar(ns: NoDaArvore[]): NoDaArvore[] {
  return ns.toSorted((a, b) => b.gasto - a.gasto);
}

export function montarArvore(
  campanhas: LinhaInsights[],
  conjuntos: LinhaInsights[],
  anuncios: LinhaInsights[],
  receitas: ReceitaPorUtmCompleta[],
): Arvore {
  const nivelCampanha = cruzar(campanhas, porCampo(receitas, 'campanha'));
  const nivelConjunto = cruzar(conjuntos, porCampo(receitas, 'conjunto'));
  const nivelAnuncio = cruzar(anuncios, porCampo(receitas, 'anuncio'));

  const porPai = new Map<string, NoDaArvore[]>();
  const pendura = (l: LinhaDeRoas, nivel: number): void => {
    if (l.paiId === null) return;
    const lista = porPai.get(l.paiId) ?? [];
    lista.push(comoNo(l, nivel));
    porPai.set(l.paiId, lista);
  };

  for (const l of nivelConjunto.linhas) pendura(l, 1);
  for (const l of nivelAnuncio.linhas) pendura(l, 2);

  const comFilhos = (no: NoDaArvore): NoDaArvore => ({
    ...no,
    filhos: ordenar(porPai.get(no.id) ?? []).map(comFilhos),
  });

  const raizes = ordenar(
    nivelCampanha.linhas.map((l) => comoNo(l, 0)),
  ).map(comFilhos);

  return {
    raizes,
    // A órfã é do nível da CAMPANHA: é a que não entra em ROAS nenhum.
    receitaOrfa: nivelCampanha.receitaOrfa,
    vendasOrfas: nivelCampanha.vendasOrfas,
    utmsSemPar: nivelCampanha.utmsSemPar,
  };
}
