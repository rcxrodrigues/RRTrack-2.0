import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { montarSnippet } from './snippet';
import type { Configuracao } from './settings';

/**
 * Este arquivo EXECUTA o snippet e olha o que ele disparou.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A TRAVA DO ROBÔ TEM DOIS LADOS, E SÓ UM DELES O SERVIDOR RESOLVE.        │
 * │                                                                          │
 * │ O servidor recusa gravar e recusa mandar para a Conversions API. Mas o   │
 * │ `fbq` do NAVEGADOR sai do aparelho de quem está na página, e o           │
 * │ rastreador que executa JavaScript — o renderizador do Google é o caso    │
 * │ comum — dispararia o Pixel direto, sem passar por nós. Esse evento       │
 * │ entra no público de remarketing.                                         │
 * │                                                                          │
 * │ Por isso a resposta do `/api/identify` traz o veredito e o `track()`     │
 * │ obedece. Ler o fonte não prova nada disso: o que prova é executar e      │
 * │ contar o que chegou ao `fbq` e ao `fetch`.                               │
 * └───────────────────────────────────────────────────────────────────────────┘
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
  pixels: [{ id: 'p1', pixelId: '111111111111111' }],
};

const ID_CRU = 'a'.repeat(32);

type Resultado = {
  /** Os `track` que chegaram ao Pixel do navegador. */
  tracks: string[];
  /** Os caminhos que o snippet chamou — é onde `/api/event` aparece. */
  caminhos: string[];
};

/** Monta o snippet com o veredito que o servidor teria dado. */
async function montar(robo: boolean): Promise<Resultado> {
  const tracks: string[] = [];
  const caminhos: string[] = [];

  const resposta = {
    ok: true,
    trck_user_id: ID_CRU,
    external_id: 'd'.repeat(64),
    gravado: true,
    robo,
  };

  const documento = {
    cookie: `_trck=${ID_CRU}`,
    readyState: 'complete',
    activeElement: null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ setAttribute: () => {}, style: {} }),
    head: { appendChild: () => {} },
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  };

  const janela = {
    location: {
      href: 'https://minhaloja.com/',
      search: '',
      origin: 'https://minhaloja.com',
    },
    document: documento,
    setTimeout: () => 0,
    fbq: (metodo: string, alvo: string) => {
      if (metodo === 'track') tracks.push(alvo);
    },
    rrtrack: undefined,
    fetch: (url: string) => {
      caminhos.push(url.replace('https://track.minhaloja.com', ''));
      return Promise.resolve({
        json: () => Promise.resolve(resposta),
        clone: () => ({ json: () => Promise.resolve(resposta) }),
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

  // O PageView sai no `.then()` do identify — ver a nota do
  // `snippet-produto.test.ts`. Ler agora pegaria os arrays vazios.
  await new Promise((r) => { setTimeout(r, 0); });

  return { tracks, caminhos };
}

describe('o snippet obedece ao veredito do servidor', () => {
  it('gente dispara PageView, no Pixel e no servidor', async () => {
    const { tracks, caminhos } = await montar(false);

    expect(tracks).toContain('PageView');
    expect(caminhos).toContain('/api/event');
  });

  it('robô não dispara NADA — nem Pixel, nem /api/event', async () => {
    const { tracks, caminhos } = await montar(true);

    expect(tracks).toEqual([]);
    expect(caminhos).not.toContain('/api/event');
  });

  it('o identify acontece nos dois casos', async () => {
    // Ele é a pergunta. Sem ele o snippet não teria como saber a resposta —
    // e é por isso que a trava não pode ficar ANTES dele.
    expect((await montar(true)).caminhos).toContain('/api/identify');
    expect((await montar(false)).caminhos).toContain('/api/identify');
  });

  it('resposta sem o campo trata como GENTE', async () => {
    // Identify fora do ar, versão antiga da rota, resposta cortada por um
    // proxy: em todos, calar o rastreamento seria pior que contar um robô.
    // O padrão erra para o lado barato.
    const tracks: string[] = [];
    const semCampo = { ok: true, trck_user_id: ID_CRU, gravado: true };

    const documento = {
      cookie: `_trck=${ID_CRU}`,
      readyState: 'complete',
      activeElement: null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ setAttribute: () => {}, style: {} }),
      head: { appendChild: () => {} },
      getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
    };
    const janela = {
      location: {
        href: 'https://minhaloja.com/',
        search: '',
        origin: 'https://minhaloja.com',
      },
      document: documento,
      setTimeout: () => 0,
      fbq: (metodo: string, alvo: string) => {
        if (metodo === 'track') tracks.push(alvo);
      },
      rrtrack: undefined,
      fetch: () =>
        Promise.resolve({
          json: () => Promise.resolve(semCampo),
          clone: () => ({ json: () => Promise.resolve(semCampo) }),
        }),
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

    expect(tracks).toContain('PageView');
  });
});
