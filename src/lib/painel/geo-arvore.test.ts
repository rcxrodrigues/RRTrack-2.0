import { describe, expect, it } from 'vitest';

import {
  montarArvoreGeo,
  SEM_DADO,
  totaisDaArvore,
  type LinhaGeoFina,
} from './geo-arvore';

function linha(p: Partial<LinhaGeoFina> & { pais: string }): LinhaGeoFina {
  return {
    regiao: null,
    cidade: null,
    visitantes: 0,
    aprovadas: 0,
    receita: 0,
    ...p,
  };
}

describe('montarArvoreGeo', () => {
  it('agrupa em três níveis', () => {
    const arvore = montarArvoreGeo([
      linha({ pais: 'BR', regiao: 'SP', cidade: 'São Paulo', visitantes: 10 }),
      linha({ pais: 'BR', regiao: 'SP', cidade: 'Campinas', visitantes: 4 }),
      linha({ pais: 'BR', regiao: 'RJ', cidade: 'Niterói', visitantes: 3 }),
    ]);

    expect(arvore).toHaveLength(1);
    expect(arvore[0]?.rotulo).toBe('BR');
    expect(arvore[0]?.filhos.map((f) => f.rotulo)).toEqual(['SP', 'RJ']);
    expect(arvore[0]?.filhos[0]?.filhos.map((f) => f.rotulo)).toEqual([
      'São Paulo',
      'Campinas',
    ]);
  });

  /*
   * A SOMA É O CONTRATO DA ÁRVORE.
   *
   * Abrir um nó é conferir de onde vem o número do pai. Se as cidades não
   * somam o estado, e o estado não soma o país, a árvore mente exatamente
   * onde promete explicar — e mente calada, porque cada número isolado
   * parece certo.
   */
  it('cada nível soma os filhos', () => {
    const arvore = montarArvoreGeo([
      linha({ pais: 'BR', regiao: 'SP', cidade: 'São Paulo', visitantes: 10, aprovadas: 2, receita: 300 }),
      linha({ pais: 'BR', regiao: 'SP', cidade: 'Campinas', visitantes: 4, aprovadas: 1, receita: 100 }),
      linha({ pais: 'BR', regiao: 'RJ', cidade: 'Niterói', visitantes: 3, aprovadas: 1, receita: 50 }),
    ]);

    const br = arvore[0];
    expect(br?.visitantes).toBe(17);
    expect(br?.receita).toBe(450);
    expect(br?.aprovadas).toBe(4);

    const sp = br?.filhos.find((f) => f.rotulo === 'SP');
    expect(sp?.visitantes).toBe(14);
    expect(sp?.receita).toBe(400);
    // E as cidades somam o estado.
    expect(sp?.filhos.reduce((s, c) => s + c.visitantes, 0)).toBe(sp?.visitantes);
    expect(sp?.filhos.reduce((s, c) => s + c.receita, 0)).toBe(sp?.receita);
  });

  /*
   * O DEFEITO QUE A CONSULTA ÚNICA EVITA.
   *
   * `painel_cidades` exige `geo_city is not null`. Quem tem país e não tem
   * cidade sumia daquela consulta — e somando as cidades para conferir o
   * estado faltaria gente, sem nada na tela dizendo por quê.
   */
  it('quem não tem cidade continua somando no estado e no país', () => {
    const arvore = montarArvoreGeo([
      linha({ pais: 'BR', regiao: 'SP', cidade: 'São Paulo', visitantes: 10, receita: 300 }),
      linha({ pais: 'BR', regiao: 'SP', cidade: null, visitantes: 6, receita: 200 }),
    ]);

    const sp = arvore[0]?.filhos[0];
    expect(sp?.visitantes).toBe(16);
    expect(sp?.receita).toBe(500);

    // E aparece com nome próprio, que é diferente de sumir.
    expect(sp?.filhos.map((c) => c.rotulo)).toContain(SEM_DADO);
    expect(sp?.filhos.reduce((s, c) => s + c.visitantes, 0)).toBe(16);
  });

  it('quem não tem nem estado também fica', () => {
    const arvore = montarArvoreGeo([
      linha({ pais: 'US', regiao: null, cidade: null, visitantes: 2, receita: 80 }),
    ]);
    expect(arvore[0]?.visitantes).toBe(2);
    expect(arvore[0]?.filhos[0]?.rotulo).toBe(SEM_DADO);
    expect(arvore[0]?.filhos[0]?.filhos[0]?.rotulo).toBe(SEM_DADO);
  });

  it('ordena por receita, com visitantes de desempate', () => {
    const arvore = montarArvoreGeo([
      linha({ pais: 'BR', regiao: 'MG', visitantes: 100, receita: 0 }),
      linha({ pais: 'BR', regiao: 'SP', visitantes: 5, receita: 900 }),
      linha({ pais: 'BR', regiao: 'RS', visitantes: 40, receita: 0 }),
    ]);

    // SP vende e lidera com 5 visitantes; entre os dois que não venderam,
    // quem tem mais gente vem antes. Sem o desempate a ordem seria
    // indefinida e a lista dançaria a cada atualização.
    expect(arvore[0]?.filhos.map((f) => f.rotulo)).toEqual(['SP', 'MG', 'RS']);
  });

  it('um estado com o mesmo nome em países diferentes não se mistura', () => {
    // 'SP' existe no Brasil e uma sigla igual pode existir noutro país; a
    // chave é composta pelo caminho, não pela sigla solta.
    const arvore = montarArvoreGeo([
      linha({ pais: 'BR', regiao: 'SP', visitantes: 10 }),
      linha({ pais: 'PT', regiao: 'SP', visitantes: 3 }),
    ]);
    expect(arvore).toHaveLength(2);
    expect(arvore.every((p) => p.filhos.length === 1)).toBe(true);
  });

  it('lista vazia devolve árvore vazia, não estoura', () => {
    expect(montarArvoreGeo([])).toEqual([]);
    expect(totaisDaArvore([])).toEqual({ visitantes: 0, receita: 0 });
  });
});

describe('totaisDaArvore', () => {
  it('soma os países — é o denominador das barras', () => {
    const arvore = montarArvoreGeo([
      linha({ pais: 'BR', visitantes: 10, receita: 300 }),
      linha({ pais: 'US', visitantes: 5, receita: 200 }),
    ]);
    expect(totaisDaArvore(arvore)).toEqual({ visitantes: 15, receita: 500 });
  });
});
