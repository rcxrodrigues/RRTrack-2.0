import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  META_GRAPH_API_BASE,
  META_GRAPH_API_VERSION,
  metaEventsEndpoint,
  metaInsightsEndpoint,
} from './constants';

const SRC = join(process.cwd(), 'src');
/** O único arquivo com permissão de citar a versão ou o host da Graph API. */
const ALLOWED = 'lib/meta/constants.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')
      ? [full]
      : [];
  });
}

describe('constante única da Graph API', () => {
  it('monta a base a partir da versão', () => {
    expect(META_GRAPH_API_BASE).toBe(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}`,
    );
  });

  it('usa um formato de versão que a Meta reconhece', () => {
    expect(META_GRAPH_API_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  it('normaliza o prefixo act_ da conta de anúncio', () => {
    const comPrefixo = metaInsightsEndpoint('act_123');
    const semPrefixo = metaInsightsEndpoint('123');
    expect(comPrefixo).toBe(semPrefixo);
    expect(comPrefixo).toContain('/act_123/insights');
  });

  it('monta o endpoint de eventos do pixel', () => {
    expect(metaEventsEndpoint('999')).toBe(`${META_GRAPH_API_BASE}/999/events`);
  });

  // A trava: atualizar a versão tem que ser mexer em UMA linha. Se outro
  // arquivo escrever "v26.0" ou o host da Graph API, este teste quebra e
  // aponta exatamente onde.
  it('nenhum outro arquivo cita a versão ou o host da Graph API', () => {
    const infratores: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).replaceAll('\\', '/');
      if (rel === ALLOWED) continue;

      const code = readFileSync(file, 'utf8');
      if (code.includes('graph.facebook.com')) {
        infratores.push(`${rel}: monta a URL da Graph API à mão`);
      }
      if (/(?<![\w.])v\d+\.\d+(?![\w.])/.test(code)) {
        infratores.push(`${rel}: escreve uma versão da Graph API`);
      }
    }

    expect(infratores).toEqual([]);
  });
});
