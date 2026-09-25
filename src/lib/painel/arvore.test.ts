import { describe, expect, it } from 'vitest';

import type { LinhaInsights } from '@/lib/meta/insights';
import type { ReceitaPorUtmCompleta } from '@/lib/painel/consultas';

import { montarArvore } from './arvore';

function linha(over: Partial<LinhaInsights> & { id: string }): LinhaInsights {
  return {
    nome: over.id,
    paiId: null,
    gasto: 100,
    impressoes: 1000,
    cliques: 50,
    comprasDaMeta: 0,
    receitaDaMeta: 0,
    ...over,
  };
}

const CAMPANHAS = [linha({ id: 'c1', nome: 'CAMP-A' }), linha({ id: 'c2', nome: 'CAMP-B' })];
const CONJUNTOS = [
  linha({ id: 's1', nome: 'CONJ-1', paiId: 'c1', gasto: 60 }),
  linha({ id: 's2', nome: 'CONJ-2', paiId: 'c1', gasto: 40 }),
];
const ANUNCIOS = [linha({ id: 'a1', nome: 'AD-1', paiId: 's1', gasto: 60 })];

function receita(over: Partial<ReceitaPorUtmCompleta> = {}): ReceitaPorUtmCompleta {
  return {
    campanha: 'CAMP-A',
    conjunto: 'CONJ-1',
    anuncio: 'AD-1',
    origem: 'facebook',
    vendas: 2,
    receita: 500,
    ...over,
  };
}

describe('montarArvore', () => {
  it('aninha conjunto sob campanha e anúncio sob conjunto', () => {
    const { raizes } = montarArvore(CAMPANHAS, CONJUNTOS, ANUNCIOS, [receita()]);
    const campA = raizes.find((r) => r.id === 'c1');
    expect(campA?.filhos.map((f) => f.id)).toEqual(['s1', 's2']);
    expect(campA?.filhos[0]?.filhos.map((f) => f.id)).toEqual(['a1']);
  });

  /*
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ CADA NÍVEL CASA COM A SUA PRÓPRIA UTM.                                 │
   * │                                                                        │
   * │ Casar tudo por `utm_campaign` daria a receita INTEIRA da campanha a    │
   * │ CADA conjunto dela: dois conjuntos de uma campanha de R$ 500 somariam  │
   * │ R$ 1.000 — o dobro do que entrou no caixa, num painel que existe       │
   * │ justamente para fechar com ele.                                        │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  it('a receita do filho NÃO é a do pai repetida', () => {
    const { raizes } = montarArvore(CAMPANHAS, CONJUNTOS, ANUNCIOS, [receita()]);
    const campA = raizes.find((r) => r.id === 'c1');

    expect(campA?.receita).toBe(500);
    // Só CONJ-1 tem venda casada; CONJ-2 não vendeu por este caminho.
    expect(campA?.filhos.find((f) => f.id === 's1')?.receita).toBe(500);
    expect(campA?.filhos.find((f) => f.id === 's2')?.receita).toBe(0);

    const soma = (campA?.filhos ?? []).reduce((s, f) => s + f.receita, 0);
    expect(soma).toBe(campA?.receita);
  });

  it('macro ausente no anúncio deixa o nível sem ROAS, não com zero', () => {
    // A venda casou com a campanha, mas o anúncio não pôs `{{ad.name}}`.
    const { raizes } = montarArvore(
      CAMPANHAS,
      CONJUNTOS,
      ANUNCIOS,
      [receita({ anuncio: '' })],
    );
    const anuncio = raizes[0]?.filhos[0]?.filhos[0];
    expect(anuncio?.receita).toBe(0);
    expect(anuncio?.roas).toBeNull();
    expect(anuncio?.motivoSemRoas).toBe('sem-casamento');
  });

  it('campo vazio não vira grupo — não existe anúncio fantasma', () => {
    const { raizes } = montarArvore(
      CAMPANHAS,
      CONJUNTOS,
      ANUNCIOS,
      [receita({ anuncio: '' }), receita({ anuncio: '', receita: 900, vendas: 3 })],
    );

    // A campanha e o conjunto FATURARAM os R$ 1.400 — as UTMs deles casaram.
    expect(raizes.find((r) => r.id === 'c1')?.receita).toBe(1400);
    expect(raizes[0]?.filhos.find((f) => f.id === 's1')?.receita).toBe(1400);

    // O anúncio, não: sem `{{ad.name}}` ninguém sabe de qual anúncio veio.
    // Nenhum nó de anúncio recebeu a receita sem dono.
    const anuncios = raizes.flatMap((r) => r.filhos.flatMap((f) => f.filhos));
    expect(anuncios.length).toBeGreaterThan(0);
    expect(anuncios.every((n) => n.receita === 0 && n.roas === null)).toBe(true);
  });

  it('ordena por gasto, do maior para o menor, em todo nível', () => {
    const { raizes } = montarArvore(
      [linha({ id: 'c1', gasto: 10 }), linha({ id: 'c2', gasto: 90 })],
      CONJUNTOS,
      [],
      [],
    );
    expect(raizes.map((r) => r.id)).toEqual(['c2', 'c1']);
    expect(raizes.find((r) => r.id === 'c1')?.filhos.map((f) => f.gasto)).toEqual([60, 40]);
  });

  it('receita fora de campanha é reportada, não somada em silêncio', () => {
    const { receitaOrfa, vendasOrfas } = montarArvore(
      CAMPANHAS,
      CONJUNTOS,
      ANUNCIOS,
      [receita({ campanha: 'CAMPANHA-QUE-NAO-EXISTE' })],
    );
    expect(receitaOrfa).toBe(500);
    expect(vendasOrfas).toBe(2);
  });
});
