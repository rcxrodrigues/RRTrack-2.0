import { describe, expect, it } from 'vitest';

import { contraste, lerHsl, nivelWcag, paraHex } from './contraste';

describe('lerHsl', () => {
  it('lê o formato dos nossos tokens', () => {
    expect(lerHsl('224 100% 60%')).toEqual({ h: 224, s: 100, l: 60 });
    expect(lerHsl('  0 0% 100%  ')).toEqual({ h: 0, s: 0, l: 100 });
  });

  it('devolve null para o que não é HSL nosso', () => {
    for (const v of ['#0037ff', 'hsl(224 100% 60%)', 'rgb(0,0,0)', '', 'azul']) {
      expect(lerHsl(v)).toBeNull();
    }
  });
});

describe('paraHex', () => {
  it('converte o azul da marca', () => {
    // hsl(226 100% 50%) é o tom dominante do logo. Implementações diferentes
    // arredondam o canal de forma ligeiramente distinta, então a conferência
    // é por proximidade, não por igualdade exata.
    const hex = paraHex({ h: 226, s: 100, l: 50 });
    expect(hex).toMatch(/^#003[bc]ff$/);
  });

  it('converte preto e branco', () => {
    expect(paraHex({ h: 0, s: 0, l: 0 })).toBe('#000000');
    expect(paraHex({ h: 0, s: 0, l: 100 })).toBe('#ffffff');
  });
});

describe('contraste', () => {
  it('dá 21:1 entre preto e branco — o máximo possível', () => {
    const razao = contraste({ h: 0, s: 0, l: 0 }, { h: 0, s: 0, l: 100 });
    expect(razao).toBeCloseTo(21, 1);
  });

  it('dá 1:1 para a mesma cor', () => {
    const cor = { h: 224, s: 100, l: 60 };
    expect(contraste(cor, cor)).toBeCloseTo(1, 5);
  });

  it('não depende da ordem dos argumentos', () => {
    const a = { h: 224, s: 100, l: 60 };
    const b = { h: 225, s: 45, l: 5 };
    expect(contraste(a, b)).toBeCloseTo(contraste(b, a), 10);
  });

  // Foi esta conta que revelou a necessidade de dois tokens de primária:
  // nenhum tom único atende aos dois papéis no tema escuro.
  it('a primária de SUPERFÍCIE aceita texto branco em cima', () => {
    const superficie = { h: 224, s: 100, l: 60 };
    const branco = { h: 0, s: 0, l: 100 };
    expect(contraste(superficie, branco)).toBeGreaterThanOrEqual(4.5);
  });

  it('a primária de TEXTO aparece sobre o fundo escuro', () => {
    const texto = { h: 224, s: 100, l: 64 };
    const fundo = { h: 225, s: 45, l: 5 };
    expect(contraste(texto, fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('e o tom de superfície NÃO serviria como texto — o motivo de existirem dois', () => {
    const superficie = { h: 224, s: 100, l: 60 };
    const fundo = { h: 225, s: 45, l: 5 };
    expect(contraste(superficie, fundo)).toBeLessThan(4.5);
  });
});

describe('nivelWcag', () => {
  it('classifica nas faixas do WCAG', () => {
    expect(nivelWcag(21).rotulo).toBe('AAA');
    expect(nivelWcag(7).rotulo).toBe('AAA');
    expect(nivelWcag(4.5).rotulo).toBe('AA');
    expect(nivelWcag(3).rotulo).toBe('AA grande');
    expect(nivelWcag(2.9).ok).toBe(false);
  });
});
