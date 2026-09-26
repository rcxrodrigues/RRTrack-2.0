import { describe, expect, it } from 'vitest';

import { dominioDoReferrer, resolverOrigem, temUtm } from './origem';

describe('temUtm', () => {
  it('é falso para nada, vazio e só espaços', () => {
    expect(temUtm(null)).toBe(false);
    expect(temUtm({})).toBe(false);
    expect(temUtm({ utmSource: '', utmCampaign: null })).toBe(false);
    // Espaço em branco não é UTM: a query `?utm_source=` chega assim, e
    // aceitá-la faria a cascata parar num nível que não sabe de nada.
    expect(temUtm({ utmSource: '   ' })).toBe(false);
  });

  it('basta uma', () => {
    expect(temUtm({ utmSource: 'facebook' })).toBe(true);
    expect(temUtm({ utmContent: 'criativo-3' })).toBe(true);
  });
});

describe('dominioDoReferrer', () => {
  it('reduz ao domínio e tira o www', () => {
    expect(dominioDoReferrer('https://www.google.com/search?q=camiseta')).toBe(
      'google.com',
    );
    expect(dominioDoReferrer('https://l.instagram.com/?u=x')).toBe(
      'l.instagram.com',
    );
  });

  it('NÃO deixa o termo de busca passar para a tela', () => {
    // O caminho da URL de busca carrega o que a pessoa digitou. Isso é dado
    // dela e não tem por que ficar numa tabela do painel — e o domínio já
    // responde a pergunta inteira.
    const saida = dominioDoReferrer(
      'https://www.google.com/search?q=comprar+remedio+para+ansiedade',
    );
    expect(saida).toBe('google.com');
    expect(saida).not.toContain('ansiedade');
  });

  it('referrer torto volta cru em vez de virar "direto"', () => {
    // Um "direto" que mente é pior que um texto estranho: ele afirma que
    // não houve origem quando houve uma que não soubemos ler.
    expect(dominioDoReferrer('lixo-que-nao-e-url')).toBe('lixo-que-nao-e-url');
  });
});

describe('resolverOrigem', () => {
  const doVisitante = {
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: 'BLACK',
    utmTerm: 'CONJ-A',
    utmContent: 'AD-7',
  };

  it('a UTM do evento ganha de todas', () => {
    const o = resolverOrigem({
      doEvento: { utmCampaign: 'DO-EVENTO' },
      doVisitante,
      referrer: 'https://google.com',
    });
    expect(o.nivel).toBe('evento');
    expect(o.rotulo).toBe('DO-EVENTO');
  });

  it('sem UTM no evento, cai para a do VISITANTE — que é o caso comum', () => {
    /*
     * O AddToCart acontece em `/products/x`, sem query string. Antes disso
     * a tabela dizia "sem campanha na UTM" na MAIORIA das linhas, e isso
     * lia como falha de marcação quando era navegação normal.
     */
    const o = resolverOrigem({ doEvento: {}, doVisitante, referrer: null });
    expect(o.nivel).toBe('visitante');
    expect(o.rotulo).toBe('BLACK › CONJ-A › AD-7');
    expect(o.fonte).toBe('facebook · cpc');
  });

  it('sem UTM nenhuma, o referrer responde', () => {
    const o = resolverOrigem({
      doEvento: {},
      doVisitante: {},
      referrer: 'https://www.tiktok.com/@perfil',
    });
    expect(o.nivel).toBe('referrer');
    expect(o.rotulo).toBe('tiktok.com');
  });

  it('sem nada, é direto — e não um campo em branco', () => {
    const o = resolverOrigem({});
    expect(o.nivel).toBe('direto');
    expect(o.rotulo).toBe('direto');
  });

  it('só utm_source vira a própria fonte, não uma trilha vazia', () => {
    // Sem campanha a trilha seria string vazia, e a célula ficaria em
    // branco parecendo defeito. Cai para origem/meio, que é o que há.
    const o = resolverOrigem({ doEvento: { utmSource: 'newsletter' } });
    expect(o.nivel).toBe('evento');
    expect(o.rotulo).toBe('newsletter');
  });

  it('a hierarquia usa › e a fonte usa ·', () => {
    // Separadores diferentes porque as coisas são diferentes: campanha ›
    // conjunto › anúncio é UM caminho; origem · meio são dois campos.
    const o = resolverOrigem({ doEvento: doVisitante });
    expect(o.rotulo).toContain('›');
    expect(o.fonte).toContain('·');
  });
});
