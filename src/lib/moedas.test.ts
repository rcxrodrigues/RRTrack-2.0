import { describe, expect, it } from 'vitest';

import { CODIGOS_MOEDA, ehMoedaSuportada, formatarDinheiro, MOEDAS } from './moedas';

describe('moedas', () => {
  it('oferece as quatro moedas de trabalho', () => {
    expect(CODIGOS_MOEDA).toEqual(['BRL', 'USD', 'EUR', 'GBP']);
  });

  it('usa códigos ISO 4217 — é o que a Meta e o GA4 aceitam', () => {
    for (const { codigo } of MOEDAS) {
      expect(codigo).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('recusa o que não está na lista', () => {
    for (const v of ['R$', 'reais', 'brl', 'XYZ', '', null, 42]) {
      expect(ehMoedaSuportada(v)).toBe(false);
    }
  });

  it('formata cada moeda com o símbolo certo', () => {
    // O espaço do Intl é não-quebrável ( ), por isso a checagem é por
    // conteúdo e não por igualdade exata de string.
    expect(formatarDinheiro(1234.5, 'BRL')).toContain('R$');
    expect(formatarDinheiro(1234.5, 'USD')).toContain('US$');
    expect(formatarDinheiro(1234.5, 'EUR')).toContain('€');
    expect(formatarDinheiro(1234.5, 'GBP')).toContain('£');
  });

  it('usa o padrão brasileiro de separadores', () => {
    expect(formatarDinheiro(1234.5, 'BRL')).toContain('1.234,50');
  });

  it('cai no real quando a moeda é desconhecida, em vez de quebrar', () => {
    expect(formatarDinheiro(10, 'XYZ')).toContain('R$');
  });
});
