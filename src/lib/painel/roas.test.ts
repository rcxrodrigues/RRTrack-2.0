import { describe, expect, it } from 'vitest';

import type { LinhaInsights } from '@/lib/meta/insights';

import { cruzar, type ReceitaPorUtm } from './roas';

/**
 * O ROAS quebra na vida real por uma razão só: a UTM não casa com o nome da
 * campanha. E quebra CALADO — um ROAS calculado sobre metade da receita
 * parece certo, e a campanha é cortada por um número que estava errado.
 */

function anuncio(over: Partial<LinhaInsights> = {}): LinhaInsights {
  return {
    id: '120210000000000',
    nome: 'BLACK-FRIDAY-ABO',
    paiId: null,
    gasto: 1000,
    impressoes: 50_000,
    cliques: 900,
    comprasDaMeta: 12,
    receitaDaMeta: 3400,
    ...over,
  };
}

function receita(over: Partial<ReceitaPorUtm> = {}): ReceitaPorUtm {
  return { campanha: 'BLACK-FRIDAY-ABO', origem: 'facebook', vendas: 10, receita: 2599, ...over };
}

describe('cruzar', () => {
  it('casa pelo NOME da campanha', () => {
    const { linhas, receitaOrfa } = cruzar([anuncio()], [receita()]);
    expect(linhas[0]?.receita).toBe(2599);
    expect(linhas[0]?.roas).toBeCloseTo(2.599);
    expect(receitaOrfa).toBe(0);
  });

  it('casa pelo ID — quem usa a macro {{campaign.id}}', () => {
    const { linhas } = cruzar(
      [anuncio()],
      [receita({ campanha: '120210000000000' })],
    );
    expect(linhas[0]?.receita).toBe(2599);
  });

  it('é indiferente a caixa e espaço — a UTM é digitada por gente', () => {
    const { linhas } = cruzar(
      [anuncio()],
      [receita({ campanha: '  black-friday-abo ' })],
    );
    expect(linhas[0]?.receita).toBe(2599);
  });

  it('soma as origens da mesma campanha', () => {
    const { linhas } = cruzar(
      [anuncio()],
      [
        receita({ origem: 'facebook', receita: 2000, vendas: 8 }),
        receita({ origem: 'instagram', receita: 599, vendas: 2 }),
      ],
    );
    expect(linhas[0]?.receita).toBe(2599);
    expect(linhas[0]?.vendas).toBe(10);
  });

  /*
   * O diagnóstico que faz a tela valer. Sem isto, uma UTM escrita errado
   * some: o ROAS cai pela metade e parece que a campanha piorou.
   */
  it('reporta a UTM que não casou, em vez de engoli-la', () => {
    const { linhas, receitaOrfa, utmsSemPar } = cruzar(
      [anuncio()],
      [receita({ campanha: 'BLACKFRIDAY-ABO' })],
    );

    expect(linhas[0]?.receita).toBe(0);
    expect(linhas[0]?.semReceitaCasada).toBe(true);
    expect(receitaOrfa).toBe(2599);
    expect(utmsSemPar).toEqual(['BLACKFRIDAY-ABO']);
  });

  it('a venda SEM utm nenhuma é órfã, e não entra em "sem par"', () => {
    // Ela não tem o que casar — não é erro de quem montou o anúncio.
    const { receitaOrfa, vendasOrfas, utmsSemPar } = cruzar(
      [anuncio()],
      [receita({ campanha: '', receita: 500, vendas: 2 })],
    );
    expect(receitaOrfa).toBe(500);
    expect(vendasOrfas).toBe(2);
    expect(utmsSemPar).toEqual([]);
  });

  it('não repete a mesma UTM sem par', () => {
    const { utmsSemPar } = cruzar(
      [anuncio()],
      [
        receita({ campanha: 'ERRADA', origem: 'facebook' }),
        receita({ campanha: 'ERRADA', origem: 'instagram' }),
      ],
    );
    expect(utmsSemPar).toEqual(['ERRADA']);
  });

  /*
   * Dividir por zero não é infinito: é "não dá para calcular". `Infinity`
   * apareceria na tela como número e ninguém saberia o que fazer com ele.
   */
  it('campanha sem gasto tem ROAS null, não infinito', () => {
    const { linhas } = cruzar([anuncio({ gasto: 0 })], [receita()]);
    expect(linhas[0]?.roas).toBeNull();
  });

  it('campanha sem venda tem CPA null, não divisão por zero', () => {
    const { linhas } = cruzar([anuncio({ comprasDaMeta: 0, receitaDaMeta: 0 })], []);
    expect(linhas[0]?.cpa).toBeNull();
    // Gastou, a Meta também não contou compra: o zero aqui é MEDIDA.
    expect(linhas[0]?.roas).toBe(0);
    expect(linhas[0]?.motivoSemRoas).toBeNull();
  });

  /*
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ `0.00×` e "não casou" são coisas DIFERENTES.                            │
   * │                                                                        │
   * │ Foi a captura de tela que pegou: uma campanha com R$ 980 de gasto       │
   * │ aparecia em vermelho com `0.00×` — e a Meta dizia 2 compras. A venda    │
   * │ existia; a `utm_campaign` do anúncio é que tinha um erro de digitação.  │
   * │ Quanto MAIOR o gasto, mais vermelho — então a primeira campanha a ser   │
   * │ cortada seria a que mais vende.                                         │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  it('a Meta contou compra e nada casou: ROAS é DESCONHECIDO, não zero', () => {
    const { linhas } = cruzar(
      [anuncio({ nome: 'TESTE-CRIATIVO' })],
      // A UTM chegou com o nome trocado — não casa com anúncio nenhum.
      [receita({ campanha: 'TESTE-CRIATVO' })],
    );
    expect(linhas[0]?.roas).toBeNull();
    expect(linhas[0]?.motivoSemRoas).toBe('sem-casamento');
  });

  it('nenhuma receita do período casou: a ponte caiu, e não é culpa da campanha', () => {
    // Duas campanhas, venda no período, e nada casa: é a macro do anúncio.
    const { linhas, receitaOrfa } = cruzar(
      [anuncio({ id: 'a', nome: 'A', comprasDaMeta: 0, receitaDaMeta: 0 }), anuncio({ id: 'b', nome: 'B', comprasDaMeta: 0, receitaDaMeta: 0 })],
      [receita({ campanha: 'nome-que-ninguem-usa' })],
    );
    expect(receitaOrfa).toBe(2599);
    expect(linhas.every((l) => l.roas === null)).toBe(true);
    expect(linhas.every((l) => l.motivoSemRoas === 'sem-casamento')).toBe(true);
  });

  it('sem venda NENHUMA no período o zero é real — a tela não vira traço', () => {
    // A diferença do caso acima: aqui não houve receita para casar.
    const { linhas } = cruzar([anuncio({ comprasDaMeta: 0, receitaDaMeta: 0 })], []);
    expect(linhas[0]?.roas).toBe(0);
    expect(linhas[0]?.motivoSemRoas).toBeNull();
  });

  it('gasto zero é sem-gasto, não sem-casamento', () => {
    const { linhas } = cruzar([anuncio({ gasto: 0 })], [receita()]);
    expect(linhas[0]?.motivoSemRoas).toBe('sem-gasto');
  });

  it('o CPA é o gasto dividido pelas NOSSAS vendas, não as da Meta', () => {
    // A Meta diz 12; nós contamos 10. O caixa conhece 10.
    const { linhas } = cruzar([anuncio()], [receita({ vendas: 10 })]);
    expect(linhas[0]?.cpa).toBe(100);
  });

  it('guarda o número da Meta para o painel mostrar a divergência', () => {
    const { linhas } = cruzar([anuncio()], [receita()]);
    expect(linhas[0]?.receitaDaMeta).toBe(3400);
    expect(linhas[0]?.receita).toBe(2599);
  });

  it('preserva a hierarquia para montar a árvore', () => {
    const { linhas } = cruzar(
      [anuncio({ id: 'adset-1', paiId: 'camp-1', nome: 'Conjunto A' })],
      [],
    );
    expect(linhas[0]?.paiId).toBe('camp-1');
  });
});
