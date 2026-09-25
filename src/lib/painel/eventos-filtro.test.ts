import { describe, expect, it } from 'vitest';

import { lerFiltro } from './eventos';

/**
 * Query string é sugestão, não comando.
 *
 * Esta função lê o que veio na URL, e a URL é digitada por qualquer um. Nada
 * aqui pode lançar, e nada pode passar adiante um valor que a consulta não
 * saiba tratar.
 */

describe('lerFiltro', () => {
  it('lê o que veio', () => {
    const f = lerFiltro({ nome: 'PageView', busca: 'abc123', pagina: '2' });
    expect(f).toEqual({ nome: 'PageView', busca: 'abc123', pagina: 2 });
  });

  it('vazio quando não veio nada', () => {
    expect(lerFiltro({})).toEqual({ nome: '', busca: '', pagina: 0 });
  });

  it('página inválida cai na primeira — nunca lança', () => {
    for (const pagina of ['-3', 'abc', '', 'Infinity', 'NaN']) {
      expect(lerFiltro({ pagina }).pagina, pagina).toBe(0);
    }
  });

  /*
   * `pagina * POR_PAGINA` vira o OFFSET da consulta, e um número grande o
   * bastante estoura o `bigint` do Postgres: a consulta FALHA em vez de
   * devolver lista vazia. O teto é o que mantém a tela quebrada de um jeito
   * inofensivo.
   */
  it('página absurda é limitada, não passa adiante', () => {
    expect(lerFiltro({ pagina: '99999999999999999999' }).pagina).toBe(1_000_000);
    expect(lerFiltro({ pagina: '1e999' }).pagina).toBe(1);
  });

  it('o parâmetro repetido na URL chega como lista, e vale o primeiro', () => {
    expect(lerFiltro({ nome: ['Purchase', 'PageView'] }).nome).toBe('Purchase');
  });

  /*
   * O corte não é estética: sem ele um parâmetro de dez mil caracteres iria
   * inteiro para o `like` do Postgres em toda requisição da tela.
   */
  it('corta valor absurdamente longo', () => {
    const enorme = 'a'.repeat(5000);
    const f = lerFiltro({ nome: enorme, busca: enorme });
    expect(f.nome.length).toBe(80);
    expect(f.busca.length).toBe(80);
  });

  it('tira espaço das pontas da busca', () => {
    expect(lerFiltro({ busca: '  abc  ' }).busca).toBe('abc');
  });
});
