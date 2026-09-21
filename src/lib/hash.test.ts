import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  hashCep,
  hashCidade,
  hashEmail,
  hashEstado,
  hashExternalId,
  hashNome,
  hashPais,
  hashTelefone,
} from './hash';

/** O hash esperado do valor JÁ normalizado. */
const esperado = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

describe('hashEmail', () => {
  it('normaliza para minúsculas antes de hashear', () => {
    const alvo = esperado('cliente@exemplo.com');
    expect(hashEmail('cliente@exemplo.com')).toBe(alvo);
    expect(hashEmail('Cliente@Exemplo.COM')).toBe(alvo);
    expect(hashEmail('  cliente@exemplo.com  ')).toBe(alvo);
  });

  it('recusa o que não é e-mail — hashear geraria um valor que nunca casa', () => {
    for (const v of ['', '   ', 'sem-arroba', null, undefined]) {
      expect(hashEmail(v)).toBeNull();
    }
  });
});

describe('hashTelefone', () => {
  // Sem o DDI, a Meta não reconhece o número. É o erro mais comum.
  it('acrescenta o 55 num número brasileiro sem DDI', () => {
    const alvo = esperado('5511999998888');
    expect(hashTelefone('(11) 99999-8888')).toBe(alvo);
    expect(hashTelefone('11999998888')).toBe(alvo);
    expect(hashTelefone('11 99999 8888')).toBe(alvo);
  });

  it('mantém o DDI quando ele já veio', () => {
    expect(hashTelefone('+55 11 99999-8888')).toBe(esperado('5511999998888'));
  });

  it('descarta zeros de discagem internacional', () => {
    expect(hashTelefone('005511999998888')).toBe(esperado('5511999998888'));
  });

  it('trata fixo de 10 dígitos', () => {
    expect(hashTelefone('(11) 3333-4444')).toBe(esperado('551133334444'));
  });

  it('aceita outro DDI quando informado', () => {
    expect(hashTelefone('7911 123456', '44')).toBe(esperado('447911123456'));
  });

  it('recusa o que é curto demais para ser telefone', () => {
    for (const v of ['', '123', '99999', null]) {
      expect(hashTelefone(v), String(v)).toBeNull();
    }
  });
});

// As expectativas abaixo saíram do `normalize.py` do SDK oficial da Meta, que
// é a implementação de referência: o que ela faz do lado dela é o que precisa
// acontecer aqui, ou os dois hashes nunca batem.
describe('hashNome', () => {
  it('normaliza para minúsculas e tira espaço das pontas', () => {
    const alvo = esperado('maria');
    expect(hashNome('Maria')).toBe(alvo);
    expect(hashNome('  MARIA  ')).toBe(alvo);
  });

  it('preserva acento — faz parte do nome', () => {
    expect(hashNome('José')).toBe(esperado('josé'));
  });

  // `normalize.py` não tem ramo para fn/ln: só minúsculas e trim. Tirar a
  // pontuação aqui geraria `obrien` contra o `o'brien` dela — e a Meta não
  // reclama de hash que não casa, ela só entrega um match pior.
  it('NÃO tira pontuação — a Meta também não tira', () => {
    expect(hashNome("O'Brien")).toBe(esperado("o'brien"));
    expect(hashNome('Jean-Luc')).toBe(esperado('jean-luc'));
    expect(hashNome('de Tal')).toBe(esperado('de tal'));
  });

  it('devolve null para vazio', () => {
    expect(hashNome('')).toBeNull();
    expect(hashNome('   ')).toBeNull();
  });
});

describe('hashCidade', () => {
  it('tira os espaços — São Paulo vira sãopaulo, com o acento preservado', () => {
    expect(hashCidade('São Paulo')).toBe(esperado('sãopaulo'));
    expect(hashCidade('SAO PAULO')).toBe(esperado('saopaulo'));
    expect(hashCidade('Rio de Janeiro')).toBe(esperado('riodejaneiro'));
  });

  it('tira dígito, ponto, hífen e parêntese — e só isso', () => {
    expect(hashCidade('Santa Cruz (RS)')).toBe(esperado('santacruzrs'));
    expect(hashCidade('St. Louis')).toBe(esperado('stlouis'));
    // Apóstrofo não está na lista da Meta: ele FICA.
    expect(hashCidade("Coeur d'Alene")).toBe(esperado("coeurd'alene"));
  });
});

describe('hashEstado', () => {
  it('normaliza a sigla', () => {
    const alvo = esperado('sp');
    expect(hashEstado('SP')).toBe(alvo);
    expect(hashEstado('sp')).toBe(alvo);
  });

  // A Vercel manda a região como "BR-SP" em alguns casos. O prefixo sai ANTES
  // da limpeza: se saísse só o hífen, sobraria `brsp`, que não casa com nada.
  it('tira o prefixo do país', () => {
    expect(hashEstado('BR-SP')).toBe(esperado('sp'));
    expect(hashEstado('GB-ENG')).toBe(esperado('eng'));
  });

  it('aceita nome por extenso com acento', () => {
    expect(hashEstado('Córdoba')).toBe(esperado('córdoba'));
  });
});

describe('hashPais', () => {
  it('aceita ISO alpha-2', () => {
    expect(hashPais('BR')).toBe(esperado('br'));
    expect(hashPais('br')).toBe(esperado('br'));
  });

  it('recusa o que não tem duas letras', () => {
    for (const v of ['BRA', 'Brasil', 'B', '']) {
      expect(hashPais(v), v).toBeNull();
    }
  });
});

describe('hashExternalId', () => {
  it('hasheia o trck_user_id como veio', () => {
    const id = 'a'.repeat(32);
    expect(hashExternalId(id)).toBe(esperado(id));
  });

  it('devolve null para vazio', () => {
    expect(hashExternalId('')).toBeNull();
    expect(hashExternalId(null)).toBeNull();
  });
});

describe('hashCep', () => {
  // A Meta tira os espaços e corta no primeiro hífen.
  it('corta no hífen', () => {
    expect(hashCep('01310-100')).toBe(esperado('01310'));
    expect(hashCep('94025-1234')).toBe(esperado('94025'));
  });

  // O projeto trabalha com libra e euro: postcode britânico é letra e número.
  it('preserva as letras — postcode não é só dígito', () => {
    expect(hashCep('SW1A 1AA')).toBe(esperado('sw1a1aa'));
    expect(hashCep('EC1A 1BB')).toBe(esperado('ec1a1bb'));
  });

  it('devolve null para vazio', () => {
    expect(hashCep('')).toBeNull();
    expect(hashCep('  ')).toBeNull();
  });
});

describe('no geral', () => {
  it('todo hash tem 64 caracteres hexadecimais', () => {
    const hashes = [
      hashEmail('a@b.com'),
      hashTelefone('11999998888'),
      hashNome('Maria'),
      hashCidade('São Paulo'),
      hashEstado('SP'),
      hashPais('BR'),
      hashExternalId('x'),
      hashCep('01310-100'),
    ];
    for (const h of hashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('nunca devolve o hash da string vazia', () => {
    const hashDoVazio = esperado('');
    const todos = [
      hashEmail(''), hashTelefone(''), hashNome(''), hashCidade(''),
      hashEstado(''), hashPais(''), hashExternalId(''), hashCep(''),
    ];
    for (const h of todos) {
      expect(h).not.toBe(hashDoVazio);
      expect(h).toBeNull();
    }
  });
});
