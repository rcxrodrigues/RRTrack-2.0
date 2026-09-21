import { describe, expect, it } from 'vitest';

import { cabecalhosCors, origemPermitida } from './cors';

const PERMITIDAS = ['https://transforlar.com', 'https://www.transforlar.com'];

describe('origemPermitida', () => {
  it('aceita origem cadastrada', () => {
    expect(origemPermitida('https://transforlar.com', PERMITIDAS)).toBe(true);
    expect(origemPermitida('https://www.transforlar.com', PERMITIDAS)).toBe(true);
  });

  it('ignora barra final e diferença de caixa', () => {
    expect(origemPermitida('https://transforlar.com/', PERMITIDAS)).toBe(true);
    expect(origemPermitida('https://TRANSFORLAR.com', PERMITIDAS)).toBe(true);
  });

  // Cada um destes é um jeito de tentar passar por transforlar.com sem ser.
  it.each([
    ['https://transforlar.com.evil.com', 'domínio que só começa igual'],
    ['https://evil-transforlar.com', 'domínio parecido'],
    ['http://transforlar.com', 'mesma origem sem TLS — é outra origem'],
    ['https://sub.transforlar.com', 'subdomínio não cadastrado'],
    ['https://transforlar.com:8443', 'porta diferente'],
    ['null', 'origem opaca, de sandbox ou redirect'],
    ['', 'vazio'],
  ])('recusa %s (%s)', (origem) => {
    expect(origemPermitida(origem, PERMITIDAS)).toBe(false);
  });

  it('recusa quando não há origem', () => {
    expect(origemPermitida(null, PERMITIDAS)).toBe(false);
  });

  // Sem origem cadastrada, o endpoint fica fechado — nunca aberto.
  it('com a lista vazia, não libera ninguém', () => {
    expect(origemPermitida('https://transforlar.com', [])).toBe(false);
  });

  it('ignora entrada inválida na lista, sem quebrar', () => {
    expect(origemPermitida('https://transforlar.com', ['não é url', 'https://transforlar.com'])).toBe(true);
    expect(origemPermitida('https://outro.com', ['não é url'])).toBe(false);
  });
});

describe('cabecalhosCors', () => {
  it('devolve a origem específica, nunca o curinga', () => {
    const h = cabecalhosCors('https://transforlar.com');
    expect(h['Access-Control-Allow-Origin']).toBe('https://transforlar.com');
    expect(h['Access-Control-Allow-Origin']).not.toBe('*');
  });

  it('permite credenciais — o cookie _trck precisa viajar', () => {
    expect(cabecalhosCors('https://x.com')['Access-Control-Allow-Credentials']).toBe('true');
  });

  // Sem Vary, um CDN pode servir a resposta de um site para outro.
  it('marca Vary: Origin', () => {
    expect(cabecalhosCors('https://x.com')['Vary']).toBe('Origin');
  });
});
