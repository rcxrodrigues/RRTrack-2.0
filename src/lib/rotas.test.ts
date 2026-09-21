import { describe, expect, it } from 'vitest';

import { caminhoInterno } from './rotas';

describe('caminhoInterno', () => {
  it('aceita caminho interno comum', () => {
    expect(caminhoInterno('/eventos')).toBe('/eventos');
    expect(caminhoInterno('/config/contas')).toBe('/config/contas');
    expect(caminhoInterno('/')).toBe('/');
  });

  // O que este guarda existe para impedir.
  it.each([
    ['//site-falso.com', 'URL protocolo-relativa'],
    ['https://site-falso.com', 'URL absoluta'],
    ['http://site-falso.com', 'URL absoluta sem TLS'],
    ['/javascript:alert(1)', 'esquema embutido'],
    ['/\\site-falso.com', 'barra invertida'],
    ['/\u0000/eventos', 'caractere de controle'],
    ['/algo\nSet-Cookie: x=1', 'quebra de linha'],
  ])('recusa %s (%s)', (entrada) => {
    expect(caminhoInterno(entrada)).toBe('/');
  });

  it('recusa o que não é string, ou é longo demais', () => {
    expect(caminhoInterno(null)).toBe('/');
    expect(caminhoInterno(undefined)).toBe('/');
    expect(caminhoInterno(42)).toBe('/');
    expect(caminhoInterno('')).toBe('/');
    expect(caminhoInterno(`/${'a'.repeat(600)}`)).toBe('/');
  });

  it('respeita o padrão informado', () => {
    expect(caminhoInterno('https://site-falso.com', '/login')).toBe('/login');
  });
});
