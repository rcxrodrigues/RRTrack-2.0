import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * O gradiente do funil, varrido no FONTE.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DUAS ARMADILHAS QUE SÓ FALHAM EM SILÊNCIO, E NENHUMA APARECE EM TESTE    │
 * │ DE COMPORTAMENTO.                                                        │
 * │                                                                          │
 * │ Prosa não varre arquivo — a lição do `token-fora-da-query.test.ts`. Um   │
 * │ comentário explicando por que estas duas linhas são assim não impede     │
 * │ ninguém de "simplificá-las", e as duas quebram sem erro nenhum.          │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const FONTE = readFileSync(
  new URL('./funil.tsx', import.meta.url),
  'utf8',
);

describe('o gradiente do funil', () => {
  /*
   * Sem `userSpaceOnUse`, o SVG usa `objectBoundingBox`: cada polígono ganha
   * a rampa INTEIRA dentro da própria caixa, e as quatro faixas saem
   * repetindo o mesmo degradê, com emenda visível em cada fronteira.
   *
   * Isso é "uma cor por etapa" entrando pela porta dos fundos — exatamente a
   * regra que o projeto tem escrita: as etapas não são identidades
   * diferentes, são a mesma quantidade encolhendo.
   */
  it('a rampa pertence ao viewBox, não a cada polígono', () => {
    expect(FONTE).toContain('gradientUnits="userSpaceOnUse"');
    // E cobre a altura toda: y de 0 a 100 no viewBox de 100.
    expect(FONTE).toMatch(/y1="0"/);
    expect(FONTE).toMatch(/y2="100"/);
  });

  /*
   * A transparência vai em `stopOpacity`. Pela especificação, o canal alfa
   * de um `stop-color` é IGNORADO — e as engines discordam na prática: o
   * WebKit ignora. Escrito como `text-chart-1/55`, o gradiente sairia certo
   * no Chromium em que eu testo e chapado no Safari do iPhone, sem erro.
   * É a armadilha do `input type=date` por outra porta: quem decide é o
   * navegador de quem olha.
   */
  it('a transparência vai em stopOpacity, nunca no alfa do stopColor', () => {
    expect(FONTE).toContain('stopOpacity');

    const stops = FONTE.match(/<stop[^>]*>/g) ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const stop of stops) {
      // `stopColor="currentColor"` passa; `stopColor="hsl(… / 0.5)"` ou uma
      // classe com barra de opacidade, não.
      expect(stop, stop).not.toMatch(/stopColor=["'][^"']*\//);
      expect(stop, stop).not.toMatch(/className=["'][^"']*\/\d/);
    }
  });

  /*
   * A etapa SEM DADO fica FORA do gradiente. Ela não é um degrau mais claro
   * do funil: é ausência de medida, e o tracejado é o que a separa. Pintada
   * com a rampa, ela viraria só mais uma faixa — e o painel passaria a
   * afirmar que ninguém chegou ali quando o que falta é o evento.
   */
  it('a etapa sem dado não recebe a rampa', () => {
    expect(FONTE).toMatch(/etapa\.desconhecido \? undefined : `url\(#/);
  });
});
