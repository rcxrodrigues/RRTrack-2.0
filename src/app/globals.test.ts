import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { contraste, deltaE, lerHsl, paraHex, type HSL } from '@/lib/contraste';

/**
 * Auditoria de contraste dos tokens de cor.
 *
 * Lê o globals.css de verdade em vez de repetir os valores aqui — uma cópia
 * envelheceria em silêncio, que é exatamente o modo de falha que este teste
 * existe para impedir.
 *
 * Escrito depois de um erro real: a primária do tema escuro foi publicada com
 * 4.36:1 sobre o fundo, abaixo do mínimo, porque a conta foi feita à mão e o
 * resultado lido como aprovado.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Os tokens declarados dentro de um seletor (`:root` ou `.dark`). */
function tokensDe(seletor: string): Map<string, HSL> {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bloco = new RegExp(`${escapado}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS);
  if (!bloco?.[1]) throw new Error(`bloco ${seletor} não encontrado no globals.css`);

  const tokens = new Map<string, HSL>();
  for (const m of bloco[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const cor = lerHsl(m[2] ?? '');
    if (cor && m[1]) tokens.set(m[1], cor);
  }
  return tokens;
}

const TEMAS = [
  { nome: 'claro', seletor: ':root' },
  { nome: 'escuro', seletor: '.dark' },
] as const;

/** Cor de TEXTO: precisa de 4.5:1 contra o fundo da página. */
const TEXTO_SOBRE_FUNDO = [
  'foreground',
  'muted-foreground',
  'primary-vivid',
  'destructive-vivid',
  'cyan',
  'amber',
  'success',
  'warning',
];

/** Par superfície → texto em cima dela. */
const SUPERFICIES: [string, string][] = [
  ['primary', 'primary-foreground'],
  ['cyan', 'cyan-foreground'],
  ['amber', 'amber-foreground'],
  ['destructive', 'destructive-foreground'],
  ['card', 'card-foreground'],
  ['popover', 'popover-foreground'],
  ['secondary', 'secondary-foreground'],
];

describe.each(TEMAS)('tema $nome', ({ seletor }) => {
  const tokens = tokensDe(seletor);
  const fundo = tokens.get('background');

  it('declara o fundo', () => {
    expect(fundo).toBeDefined();
  });

  it.each(TEXTO_SOBRE_FUNDO)('%s tem 4.5:1 sobre o fundo', (nome) => {
    const cor = tokens.get(nome);
    expect(cor, `token --${nome} não existe`).toBeDefined();
    if (!cor || !fundo) return;

    const razao = contraste(cor, fundo);
    expect(
      razao,
      `--${nome} (${paraHex(cor)}) sobre --background (${paraHex(fundo)}) = ${razao.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SUPERFICIES)('%s aceita %s em cima', (superficie, textoEmCima) => {
    const s = tokens.get(superficie);
    const t = tokens.get(textoEmCima);
    if (!s || !t) return;

    const razao = contraste(s, t);
    expect(
      razao,
      `--${textoEmCima} (${paraHex(t)}) sobre --${superficie} (${paraHex(s)}) = ${razao.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('as cores de gráfico se distinguem entre si', () => {
    const chart = [1, 2, 3, 4, 5]
      .map((n) => tokens.get(`chart-${n}`))
      .filter((c): c is HSL => c !== undefined);

    expect(chart).toHaveLength(5);

    // A métrica aqui é ΔE, não razão de contraste: azul e âmbar têm
    // luminância parecida e mesmo assim ninguém os confunde. Contraste mede
    // luminância; distinguir séries é questão de distância perceptual.
    // 15 é o piso da skill de visualização para leitura com visão normal.
    for (let i = 0; i < chart.length; i += 1) {
      for (let j = i + 1; j < chart.length; j += 1) {
        const a = chart[i];
        const b = chart[j];
        if (!a || !b) continue;
        const distancia = deltaE(a, b);
        expect(
          distancia,
          `chart-${i + 1} (${paraHex(a)}) e chart-${j + 1} (${paraHex(b)}) ΔE ${distancia.toFixed(1)}`,
        ).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('as cores de gráfico aparecem sobre o fundo', () => {
    const chart = [1, 2, 3, 4, 5]
      .map((n) => tokens.get(`chart-${n}`))
      .filter((c): c is HSL => c !== undefined);

    for (const [i, cor] of chart.entries()) {
      if (!fundo) return;
      const razao = contraste(cor, fundo);
      // 3:1 é o piso para marca gráfica — barra e linha não são texto.
      expect(
        razao,
        `chart-${i + 1} (${paraHex(cor)}) sobre o fundo = ${razao.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
