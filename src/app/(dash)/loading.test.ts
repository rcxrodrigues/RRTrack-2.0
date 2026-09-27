import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Toda rota do painel tem o `loading.tsx` dela.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ É O MODO DE FALHA CLÁSSICO DESTE PROJETO, POR OUTRA PORTA.               │
 * │                                                                          │
 * │ `loading.tsx` vale para TODA rota abaixo dele. Uma aba nova sem a sua    │
 * │ não fica sem esqueleto — ela herda o da VISÃO GERAL, com seis métricas,  │
 * │ funil e três listas de geo, e depois troca por uma tela que não tem      │
 * │ nada disso. Esqueleto com a geometria de outra tela é pior que nenhum.   │
 * │                                                                          │
 * │ Foi exatamente o que aconteceu com `/estilo`: o CLAUDE.md dizia "aba     │
 * │ nova nasce com o loading.tsx dela" e nada fazia a regra valer, então a   │
 * │ rota que já existia ficou de fora quando os esqueletos entraram.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const DASH = path.join(process.cwd(), 'src/app/(dash)');

/** Toda pasta com `page.tsx` abaixo do `(dash)`, incluindo o próprio. */
function rotas(dir: string): string[] {
  const achadas: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    // `_components` e afins não são rotas.
    if (item.name.startsWith('_')) continue;
    achadas.push(...rotas(path.join(dir, item.name)));
  }
  if (fs.existsSync(path.join(dir, 'page.tsx'))) achadas.push(dir);
  return achadas;
}

describe('esqueleto de navegação', () => {
  const todas = rotas(DASH);

  it('encontra as rotas do painel', () => {
    // Se esta contagem cair para zero, o teste abaixo passaria vazio e a
    // regra deixaria de valer sem ninguém notar.
    expect(todas.length).toBeGreaterThanOrEqual(6);
  });

  it.each(todas.map((d) => path.relative(process.cwd(), d)))(
    '%s tem loading.tsx',
    (relativo) => {
      expect(fs.existsSync(path.join(process.cwd(), relativo, 'loading.tsx'))).toBe(
        true,
      );
    },
  );
});
