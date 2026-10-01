/**
 * Geo em árvore: País > Estado > Cidade.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ÁRVORE, E NÃO TRÊS LISTAS SOLTAS.                                │
 * │                                                                          │
 * │ As três listas respondiam "quem são os maiores" em cada grão, e não      │
 * │ respondiam a pergunta que importa: DE ONDE veio a conversão. Ver "SP"    │
 * │ na lista de regiões e "Campinas" na de cidades não diz se Campinas está  │
 * │ dentro daquele SP nem quanto ela pesa nele — e é isso que decide frete,  │
 * │ prazo e corte de campanha.                                               │
 * │                                                                          │
 * │ A árvore responde: abre o país, vê os estados; abre o estado, vê as      │
 * │ cidades. Cada nível com receita e visitantes lado a lado, que é a        │
 * │ comparação que já valia — região que aparece numa e não na outra é       │
 * │ tráfego que não converte.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * **Os níveis de cima somam a partir das MESMAS linhas do grão fino.** Não é
 * preciosismo: somar o país de uma consulta e o estado de outra faria os dois
 * discordarem quando alguém tem país e não tem estado — e numa árvore, em que
 * abrir o nó é justamente conferir a soma, discordar é o pior defeito
 * possível. Aqui fecha por construção.
 */

import { nomeDoEstado, nomeDoPais } from './lugares';

/** Uma linha no grão mais fino, como vem de `painel_geo_arvore`. */
export type LinhaGeoFina = {
  pais: string;
  regiao: string | null;
  cidade: string | null;
  visitantes: number;
  aprovadas: number;
  receita: number;
};

export type NoGeo = {
  /** O que identifica o nó dentro do pai — a sigla ou o nome. */
  chave: string;
  rotulo: string;
  visitantes: number;
  aprovadas: number;
  receita: number;
  filhos: NoGeo[];
};

/**
 * O rótulo de um nível sem dado.
 *
 * A Vercel manda país sempre e cidade nem sempre. Essas pessoas existem e
 * gastaram dinheiro: jogá-las fora encolheria o total do pai e faria a árvore
 * mentir na soma. Aparecem com nome próprio, que é diferente de sumir.
 */
export const SEM_DADO = 'Não informado';

function vazio(chave: string, rotulo: string): NoGeo {
  return {
    chave,
    rotulo,
    visitantes: 0,
    aprovadas: 0,
    receita: 0,
    filhos: [],
  };
}

function somar(no: NoGeo, linha: LinhaGeoFina): void {
  no.visitantes += linha.visitantes;
  no.aprovadas += linha.aprovadas;
  no.receita += linha.receita;
}

/**
 * Maior receita primeiro; empate desempata por visitantes.
 *
 * Receita antes de gente porque a pergunta da tela é de onde vem o DINHEIRO.
 * Sem o desempate, duas regiões sem venda nenhuma sairiam em ordem
 * indefinida e a lista dançaria a cada atualização sem nada ter mudado.
 */
function porPeso(a: NoGeo, b: NoGeo): number {
  return b.receita - a.receita || b.visitantes - a.visitantes;
}

function ordenar(nos: NoGeo[]): NoGeo[] {
  nos.sort(porPeso);
  for (const no of nos) ordenar(no.filhos);
  return nos;
}

/** Monta a árvore a partir do grão fino. */
export function montarArvoreGeo(linhas: readonly LinhaGeoFina[]): NoGeo[] {
  const paises = new Map<string, NoGeo>();

  for (const linha of linhas) {
    let pais = paises.get(linha.pais);
    if (!pais) {
      /*
       * A CHAVE continua sendo o código, e só o RÓTULO vira nome.
       *
       * A chave é identidade: é por ela que o mapa acha o estado e que o
       * React distingue as linhas. Traduzi-la juntaria dois países que a
       * tabela não conhece — os dois cairiam no próprio código e tudo bem,
       * mas o dia em que dois códigos mapeassem para o mesmo nome eles
       * viravam uma linha só, somando dinheiro de lugares diferentes.
       */
      pais = vazio(linha.pais, nomeDoPais(linha.pais));
      paises.set(linha.pais, pais);
    }
    somar(pais, linha);

    const chaveRegiao = linha.regiao ?? '';
    let regiao = pais.filhos.find((f) => f.chave === chaveRegiao);
    if (!regiao) {
      regiao = vazio(
        chaveRegiao,
        linha.regiao === null
          ? SEM_DADO
          : // O país vai junto porque a sigla sozinha é ambígua: `PA` é Pará
            // aqui e Pensilvânia nos Estados Unidos, e a Vercel manda crua.
            nomeDoEstado(linha.regiao, linha.pais),
      );
      pais.filhos.push(regiao);
    }
    somar(regiao, linha);

    const chaveCidade = linha.cidade ?? '';
    let cidade = regiao.filhos.find((f) => f.chave === chaveCidade);
    if (!cidade) {
      cidade = vazio(chaveCidade, linha.cidade ?? SEM_DADO);
      regiao.filhos.push(cidade);
    }
    somar(cidade, linha);
  }

  return ordenar([...paises.values()]);
}

/** Os totais do topo, para a barra de cada nó ter denominador. */
export function totaisDaArvore(nos: readonly NoGeo[]): {
  visitantes: number;
  receita: number;
} {
  return nos.reduce(
    (acc, no) => ({
      visitantes: acc.visitantes + no.visitantes,
      receita: acc.receita + no.receita,
    }),
    { visitantes: 0, receita: 0 },
  );
}
