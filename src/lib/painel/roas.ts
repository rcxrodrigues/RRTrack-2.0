import type { LinhaInsights } from '@/lib/meta/insights';

/**
 * O cruzamento gasto × receita — e onde ele costuma falhar.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A Meta sabe quanto você GASTOU. Só nós sabemos quanto ENTROU. O que liga │
 * │ os dois é a UTM de campanha, e é aí que o ROAS quebra na vida real:      │
 * │ quem monta o anúncio escreve `utm_campaign` à mão, ou usa a macro        │
 * │ `{{campaign.name}}`, ou `{{campaign.id}}` — e cada escolha casa de um    │
 * │ jeito.                                                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Por isso o acerto tenta as duas formas, e o que NÃO casou é reportado em
 * vez de sumir. Um ROAS calculado sobre metade da receita é pior que nenhum:
 * ele parece certo.
 */

export type ReceitaPorUtm = {
  campanha: string;
  origem: string;
  vendas: number;
  receita: number;
};

export type LinhaDeRoas = {
  id: string;
  nome: string;
  paiId: string | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  /** A receita NOSSA, casada por UTM. */
  receita: number;
  vendas: number;
  /** `null` quando não houve gasto: dividir por zero não é infinito, é "não dá". */
  roas: number | null;
  /** Custo por aquisição. `null` sem venda. */
  cpa: number | null;
  /** O que a Meta diz. Guardado para o painel poder mostrar a divergência. */
  receitaDaMeta: number;
  comprasDaMeta: number;
  /** `true` quando nenhuma UTM casou com esta linha. */
  semReceitaCasada: boolean;
};

export type Cruzamento = {
  linhas: LinhaDeRoas[];
  /** Receita que não casou com campanha nenhuma da Meta. */
  receitaOrfa: number;
  vendasOrfas: number;
  /** As UTMs que sobraram sem par — o diagnóstico de quem montou errado. */
  utmsSemPar: string[];
};

/** Normaliza para comparar: a UTM vem do anúncio, digitada por gente. */
function chave(texto: string): string {
  return texto.trim().toLowerCase();
}

export function cruzar(
  insights: LinhaInsights[],
  receitas: ReceitaPorUtm[],
): Cruzamento {
  /*
   * Um índice com as DUAS formas de casar: o id da campanha e o nome dela.
   * Quem usa `{{campaign.id}}` na macro casa pelo primeiro; quem escreve o
   * nome à mão (ou usa `{{campaign.name}}`) casa pelo segundo.
   */
  const porChave = new Map<string, string>();
  for (const linha of insights) {
    porChave.set(chave(linha.id), linha.id);
    porChave.set(chave(linha.nome), linha.id);
  }

  const acumulado = new Map<string, { receita: number; vendas: number }>();
  let receitaOrfa = 0;
  let vendasOrfas = 0;
  const utmsSemPar: string[] = [];

  for (const r of receitas) {
    // Campanha vazia é a venda sem atribuição: ela é receita real, e some do
    // ROAS de qualquer jeito. Contada à parte para o painel poder dizer.
    const alvo = r.campanha ? porChave.get(chave(r.campanha)) : undefined;

    if (alvo === undefined) {
      receitaOrfa += r.receita;
      vendasOrfas += r.vendas;
      if (r.campanha) utmsSemPar.push(r.campanha);
      continue;
    }

    const atual = acumulado.get(alvo) ?? { receita: 0, vendas: 0 };
    acumulado.set(alvo, {
      receita: atual.receita + r.receita,
      vendas: atual.vendas + r.vendas,
    });
  }

  const linhas = insights.map((linha) => {
    const nosso = acumulado.get(linha.id) ?? { receita: 0, vendas: 0 };

    return {
      id: linha.id,
      nome: linha.nome,
      paiId: linha.paiId,
      gasto: linha.gasto,
      impressoes: linha.impressoes,
      cliques: linha.cliques,
      receita: nosso.receita,
      vendas: nosso.vendas,
      // Sem gasto não há retorno sobre gasto. `Infinity` apareceria na tela
      // como número e ninguém saberia o que fazer com ele.
      roas: linha.gasto > 0 ? nosso.receita / linha.gasto : null,
      cpa: nosso.vendas > 0 ? linha.gasto / nosso.vendas : null,
      receitaDaMeta: linha.receitaDaMeta,
      comprasDaMeta: linha.comprasDaMeta,
      semReceitaCasada: nosso.vendas === 0,
    };
  });

  return {
    linhas,
    receitaOrfa,
    vendasOrfas,
    // Sem repetição: a mesma campanha aparece uma vez por `utm_source`.
    utmsSemPar: [...new Set(utmsSemPar)],
  };
}
