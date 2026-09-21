import { describe, expect, it } from 'vitest';

import {
  ehTrckUserIdValido,
  gerarTrckUserId,
  normalizarTrckUserId,
  trckUserIdDaUrl,
} from './trck';

describe('gerarTrckUserId', () => {
  it('gera 32 caracteres hexadecimais, sem hífen', () => {
    const id = gerarTrckUserId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain('-');
  });

  it('não repete', () => {
    const ids = new Set(Array.from({ length: 500 }, gerarTrckUserId));
    expect(ids.size).toBe(500);
  });
});

describe('ehTrckUserIdValido', () => {
  it('aceita o que geramos', () => {
    expect(ehTrckUserIdValido(gerarTrckUserId())).toBe(true);
  });

  // Tudo isto pode chegar pela URL; nada disso pode virar linha no banco.
  it.each([
    ['', 'vazio'],
    ['abc', 'curto demais'],
    ['g'.repeat(32), 'fora do hexadecimal'],
    ['0'.repeat(33), 'longo demais'],
    ['0'.repeat(31), 'curto por um'],
    ["' OR 1=1--", 'tentativa de SQL'],
    ['<script>alert(1)</script>', 'tentativa de script'],
    ['../../etc/passwd', 'travessia de caminho'],
  ])('recusa %s (%s)', (valor) => {
    expect(ehTrckUserIdValido(valor)).toBe(false);
  });

  it('recusa o que não é texto', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(ehTrckUserIdValido(v)).toBe(false);
    }
  });
});

describe('normalizarTrckUserId', () => {
  it('aceita a forma com hífens e devolve sem', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(normalizarTrckUserId(id)).toBe('550e8400e29b41d4a716446655440000');
  });

  it('aceita maiúsculas', () => {
    expect(normalizarTrckUserId('ABCDEF01'.repeat(4))).toBe('abcdef01'.repeat(4));
  });

  it('ignora espaço em volta — copiar e colar costuma trazer', () => {
    const id = gerarTrckUserId();
    expect(normalizarTrckUserId(`  ${id}  `)).toBe(id);
  });

  it('devolve null para o que não serve', () => {
    expect(normalizarTrckUserId('qualquer coisa')).toBeNull();
    expect(normalizarTrckUserId(null)).toBeNull();
  });
});

describe('trckUserIdDaUrl', () => {
  const id = 'a'.repeat(32);

  it.each(['trck_user_id', 'trck', 'trck_id'])('lê o parâmetro %s', (nome) => {
    expect(trckUserIdDaUrl(new URLSearchParams(`${nome}=${id}`))).toBe(id);
  });

  it('prefere trck_user_id quando há mais de um', () => {
    const params = new URLSearchParams(`trck=${'b'.repeat(32)}&trck_user_id=${id}`);
    expect(trckUserIdDaUrl(params)).toBe(id);
  });

  it('pula um parâmetro inválido e segue procurando', () => {
    const params = new URLSearchParams(`trck_user_id=lixo&trck=${id}`);
    expect(trckUserIdDaUrl(params)).toBe(id);
  });

  it('devolve null quando não há nenhum', () => {
    expect(trckUserIdDaUrl(new URLSearchParams('utm_source=meta'))).toBeNull();
  });
});
