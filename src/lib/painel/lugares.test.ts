import { describe, expect, it } from 'vitest';

import { nomeDoEstado, nomeDoPais, PAISES_CONHECIDOS } from './lugares';

/*
 * Nome de lugar vem de TABELA, não do `Intl.DisplayNames`.
 *
 * Mesma armadilha do `Intl.NumberFormat`: ele depende do ICU, e o do Node
 * não é o do navegador. A árvore é renderizada no servidor e hidratada no
 * cliente — dois textos diferentes para o mesmo país quebram a hidratação.
 */
describe('nomeDoEstado', () => {
  it('traduz nas duas formas que chegam do cabeçalho', () => {
    expect(nomeDoEstado('BR-SP')).toBe('São Paulo');
    expect(nomeDoEstado('SP')).toBe('São Paulo');
    expect(nomeDoEstado('BR-RJ')).toBe('Rio de Janeiro');
    expect(nomeDoEstado('BR-DF')).toBe('Distrito Federal');
  });

  it('o que não é estado do Brasil volta CRU, nunca traduzido errado', () => {
    // `US-PA` é Pensilvânia. Devolver "Pará" seria pior que devolver o
    // código: o código quem lê sabe interpretar, o nome errado engana.
    expect(nomeDoEstado('US-PA')).toBe('US-PA');
    expect(nomeDoEstado('BR-XX')).toBe('BR-XX');
    expect(nomeDoEstado('qualquer')).toBe('qualquer');
  });
});

describe('nomeDoPais', () => {
  it('traduz os que aparecem num funil brasileiro', () => {
    expect(nomeDoPais('BR')).toBe('Brasil');
    expect(nomeDoPais('PT')).toBe('Portugal');
    expect(nomeDoPais('US')).toBe('Estados Unidos');
    expect(nomeDoPais('br')).toBe('Brasil');
  });

  /*
   * A TABELA É COMPLETA, e a tela real é que ensinou por quê.
   *
   * A primeira versão tinha os ~25 países que eu supus que apareceriam, e o
   * resto caía no código. Na conta de verdade a árvore saiu com "Estados
   * Unidos", "Brasil", "Alemanha"… e `CN` e `FI` no meio. Nome e código
   * misturados na mesma lista não leem como "este eu não conheço": leem
   * como defeito.
   *
   * E o tráfego de um site aberto não é o que a oferta mira — rastreador e
   * bot chegam de qualquer canto. Supor a lista era supor o que não dá.
   */
  it('traduz TODOS os países de onde o tráfego pode vir', () => {
    // Os que apareceram na conta real e não estavam na tabela parcial.
    expect(nomeDoPais('CN')).toBe('China');
    expect(nomeDoPais('FI')).toBe('Finlândia');
    expect(nomeDoPais('DE')).toBe('Alemanha');
    // E uma amostra do resto do mundo, que a versão parcial também perdia.
    expect(nomeDoPais('ZW')).toBe('Zimbábue');
    expect(nomeDoPais('VN')).toBe('Vietnã');
    expect(nomeDoPais('SG')).toBe('Singapura');
    expect(nomeDoPais('NG')).toBe('Nigéria');
    expect(nomeDoPais('RU')).toBe('Rússia');
    expect(nomeDoPais('IN')).toBe('Índia');
  });

  it('nenhum código ISO fica de fora', () => {
    // 249 é o total do ISO 3166-1 alpha-2. Faltando um, ele volta cru e a
    // lista volta a misturar nome com código.
    const todos = Object.keys(PAISES_CONHECIDOS);
    expect(todos).toHaveLength(249);
    for (const cod of todos) {
      expect(cod, cod).toMatch(/^[A-Z]{2}$/);
      expect(nomeDoPais(cod), cod).not.toBe(cod);
    }
  });

  it('código que não é país volta cru, nunca um nome inventado', () => {
    // O Cloudflare manda `XX` e `T1` em alguns casos; `normalizarPais` já
    // filtra, mas inventar nome para o que chegar aqui seria pior.
    expect(nomeDoPais('XX')).toBe('XX');
    expect(nomeDoPais('ZZ')).toBe('ZZ');
  });
});
