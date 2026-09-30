import { describe, expect, it } from 'vitest';

import { nomeDoEstado, nomeDoPais } from './lugares';

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

  it('país fora da tabela volta a sigla, e isso é a resposta certa', () => {
    // A tabela é parcial de propósito. O que falta cai no código, que é
    // exatamente o que a tela mostrava antes — nunca um nome inventado.
    expect(nomeDoPais('ZW')).toBe('ZW');
    expect(nomeDoPais('XX')).toBe('XX');
  });
});
