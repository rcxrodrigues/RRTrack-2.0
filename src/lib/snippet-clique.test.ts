import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { ehObjeto, texto } from './json';
import { montarSnippet } from './snippet';
import type { Configuracao } from './settings';

/**
 * Este arquivo EXECUTA o snippet e olha o corpo que foi para o
 * `/api/identify`.
 *
 * O clique do anúncio é o dado que MENOS perdoa: chega uma vez, na URL da
 * visita, e nem a Shopify, nem o checkout, nem o gateway o conhecem depois.
 * Não lido na hora, não volta — e não volta em silêncio, porque a venda
 * simplesmente aparece sem origem.
 *
 * São TRÊS parâmetros e cada um vira uma coisa diferente:
 *
 * | na URL   | vira            | por quê |
 * |----------|-----------------|---------|
 * | `fbclid` | `fbc` (montado) | a Meta quer `fb.1.<ts>.<fbclid>` |
 * | `gclid`  | `gclid` cru     | o ClickConversion do Google o quer cru |
 * | `wbraid` | `wbraid` cru    | é o que chega quando o consentimento limita o gclid |
 *
 * Ler o fonte por string diria que os três são lidos, não que chegam ao
 * corpo com o nome certo — e nome errado num campo de clique é perda de
 * atribuição sem erro nenhum na tela.
 */

const CONFIG: Configuracao = {
  settings: {
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    testEventCode: null,
    cookieDomain: '.minhaloja.com',
    origensPermitidas: ['https://minhaloja.com'],
    dominiosCheckout: [],
    statusPorAlias: {},
  },
  ga4: [],
  pixels: [],
};

type Ambiente = { identifies: Record<string, unknown>[] };

/** Ver a nota do `snippet-produto.test.ts`: a partida é assíncrona. */
async function montar(query: string): Promise<Ambiente> {
  const identifies: Record<string, unknown>[] = [];
  const href = `https://minhaloja.com/${query}`;

  const documento = {
    cookie: `_trck=${'a'.repeat(32)}`,
    readyState: 'complete',
    activeElement: null,
    referrer: '',
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ setAttribute: () => {}, style: {} }),
    head: { appendChild: () => {} },
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  };

  const janela = {
    location: {
      href,
      search: query.startsWith('?') ? query : '',
      origin: 'https://minhaloja.com',
    },
    document: documento,
    setTimeout: () => 0,
    fetch: (url: string, opcoes?: { body?: string }) => {
      if (url.includes('/api/identify') && opcoes?.body) {
        const corpo: unknown = JSON.parse(opcoes.body);
        if (ehObjeto(corpo)) identifies.push(corpo);
      }
      return Promise.resolve({
        json: () => Promise.resolve({}),
        clone: () => ({ json: () => Promise.resolve({}) }),
      });
    },
    URL,
    URLSearchParams,
    crypto: { randomUUID: () => 'id-de-teste' },
  };

  const contexto = vm.createContext({
    window: janela,
    document: documento,
    fetch: janela.fetch,
    URL,
    URLSearchParams,
    console,
  });
  vm.runInContext(montarSnippet('https://track.minhaloja.com', CONFIG), contexto);

  await new Promise((r) => { setTimeout(r, 0); });

  return { identifies };
}

const GCLID = 'Cj0KCQjw-abcDEF123_xyz';
const WBRAID = 'Cr4KCQjw_wbraid_1';

describe('o clique do anúncio na URL', () => {
  it('manda o gclid ao /api/identify, com esse nome', async () => {
    const { identifies } = await montar(`?gclid=${GCLID}`);

    expect(identifies).not.toHaveLength(0);
    expect(texto(identifies[0], 'gclid')).toBe(GCLID);
  });

  it('manda o wbraid — o clique que o consentimento restringiu', async () => {
    const { identifies } = await montar(`?wbraid=${WBRAID}`);

    expect(texto(identifies[0], 'wbraid')).toBe(WBRAID);
  });

  it('manda o gclid CRU: quem transforma é o fbclid, não ele', async () => {
    const { identifies } = await montar(`?gclid=${GCLID}&fbclid=IwAR_meta`);
    const corpo = identifies[0];

    // O fbclid vai cru também aqui — o servidor é que monta o `fbc`. O que
    // este teste trava é que o gclid não ganha prefixo nem timestamp.
    expect(texto(corpo, 'gclid')).toBe(GCLID);
    expect(texto(corpo, 'gclid')).not.toContain('.');
    expect(texto(corpo, 'fbclid')).toBe('IwAR_meta');
  });

  it('os três convivem na mesma visita', async () => {
    const { identifies } = await montar(
      `?fbclid=IwAR_meta&gclid=${GCLID}&wbraid=${WBRAID}&utm_source=google`,
    );
    const corpo = identifies[0];

    expect(texto(corpo, 'fbclid')).toBe('IwAR_meta');
    expect(texto(corpo, 'gclid')).toBe(GCLID);
    expect(texto(corpo, 'wbraid')).toBe(WBRAID);
    // E a UTM continua atravessando junto, que é o par do clique.
    expect(texto(corpo, 'utm_source')).toBe('google');
  });

  it('visita sem clique nenhum não manda as chaves', async () => {
    const { identifies } = await montar('');
    const corpo = identifies[0];

    // `undefined` sai no JSON.stringify, então a chave nem viaja — e é isso
    // que faz a volta sem clique não apagar o clique da primeira visita.
    expect(corpo).not.toHaveProperty('gclid');
    expect(corpo).not.toHaveProperty('wbraid');
    expect(corpo).not.toHaveProperty('fbclid');
  });
});
