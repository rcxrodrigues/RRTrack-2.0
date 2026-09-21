import { describe, expect, it } from 'vitest';

import {
  clientIdDoGa,
  lerCookies,
  lerFbp,
  lerOuMontarFbc,
  nomeCookieSessaoGa,
  sessionIdDoGa,
} from './cookies-terceiros';

describe('clientIdDoGa', () => {
  it('extrai os dois últimos segmentos', () => {
    expect(clientIdDoGa('GA1.1.1234567890.1698765432')).toBe('1234567890.1698765432');
  });

  // O prefixo varia com a profundidade do domínio; ler do fim resolve.
  it('funciona com prefixos de tamanhos diferentes', () => {
    expect(clientIdDoGa('GA1.2.1234567890.1698765432')).toBe('1234567890.1698765432');
    expect(clientIdDoGa('GA1.3.1.1234567890.1698765432')).toBe('1234567890.1698765432');
  });

  it('recusa valor que não tem a forma esperada', () => {
    for (const v of ['', 'GA1.1', 'GA1.1.abc.def', 'lixo', 'GA1.1.123']) {
      expect(clientIdDoGa(v), v).toBeNull();
    }
  });

  it('devolve null quando o cookie não existe', () => {
    expect(clientIdDoGa(undefined)).toBeNull();
  });
});

describe('sessionIdDoGa', () => {
  it('lê o formato GS1', () => {
    expect(sessionIdDoGa('GS1.1.1698765432.3.1.1698765500.0.0.0')).toBe('1698765432');
  });

  // O GA4 passou a gravar GS2; um site antigo pode ainda estar no GS1, então
  // os dois precisam funcionar.
  it('lê o formato GS2', () => {
    expect(sessionIdDoGa('GS2.1.s1698765432$o1$g0$t1698765500$j60$l0$h0')).toBe(
      '1698765432',
    );
  });

  it('recusa o que não reconhece', () => {
    for (const v of ['', 'GS3.1.x', 'lixo', 'GS1.1.abc.1']) {
      expect(sessionIdDoGa(v), v).toBeNull();
    }
  });
});

describe('nomeCookieSessaoGa', () => {
  it('monta o nome a partir do measurement id', () => {
    expect(nomeCookieSessaoGa('G-ABC123XYZ')).toBe('_ga_ABC123XYZ');
  });
});

describe('lerFbp', () => {
  it('aceita o formato do Pixel', () => {
    expect(lerFbp('fb.1.1698765432000.1234567890')).toBe('fb.1.1698765432000.1234567890');
  });

  it('recusa valor de outro formato — enviar lixo piora o match na Meta', () => {
    for (const v of ['', 'lixo', 'fb.1', 'fb.x.1.2', '1698765432']) {
      expect(lerFbp(v), v).toBeNull();
    }
  });
});

describe('lerOuMontarFbc', () => {
  it('prefere o cookie quando ele existe', () => {
    const doCookie = 'fb.1.1698765432000.AbCdEf';
    expect(lerOuMontarFbc(doCookie, 'OutroFbclid', 999)).toBe(doCookie);
  });

  // Este é o caso que salva a atribuição: sem o Pixel ter rodado, o clique
  // do anúncio só existe no fbclid da URL.
  it('monta a partir do fbclid quando não há cookie', () => {
    expect(lerOuMontarFbc(undefined, 'IwAR0abc123', 1_700_000_000_000)).toBe(
      'fb.1.1700000000000.IwAR0abc123',
    );
  });

  it('monta também quando o cookie está corrompido', () => {
    expect(lerOuMontarFbc('lixo', 'IwAR0abc', 1_700_000_000_000)).toBe(
      'fb.1.1700000000000.IwAR0abc',
    );
  });

  it('recusa fbclid com caractere que não pertence a um', () => {
    for (const v of ['tem espaço', 'tem.ponto', '<script>', '']) {
      expect(lerOuMontarFbc(undefined, v), v).toBeNull();
    }
  });

  it('devolve null sem cookie e sem fbclid', () => {
    expect(lerOuMontarFbc(undefined, undefined)).toBeNull();
  });
});

describe('lerCookies', () => {
  it('lê o cabeçalho Cookie', () => {
    const c = lerCookies('_trck=abc123; _fbp=fb.1.2.3; _ga=GA1.1.4.5');
    expect(c.get('_trck')).toBe('abc123');
    expect(c.get('_fbp')).toBe('fb.1.2.3');
    expect(c.get('_ga')).toBe('GA1.1.4.5');
  });

  it('aguenta valor com sinal de igual dentro', () => {
    expect(lerCookies('token=abc=def==').get('token')).toBe('abc=def==');
  });

  it('fica com o primeiro quando o nome repete', () => {
    expect(lerCookies('a=1; a=2').get('a')).toBe('1');
  });

  it('devolve mapa vazio sem cabeçalho, em vez de quebrar', () => {
    expect(lerCookies(null).size).toBe(0);
    expect(lerCookies('').size).toBe(0);
    expect(lerCookies('lixo-sem-igual').size).toBe(0);
  });
});
