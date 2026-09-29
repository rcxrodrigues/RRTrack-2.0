import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { montarSnippet } from './snippet';
import type { Configuracao } from './settings';

/**
 * Este arquivo EXECUTA o snippet e olha o que chegou ao `fbq`.
 *
 * O `fbq('init', id)` nascia sem o segundo argumento. Então o que o site
 * contasse pelo `rrtrack.identify({ email })` ia para o SERVIDOR e não para
 * o Pixel — metade do sinal perdida numa porta que já estava aberta, e sem
 * nada quebrar: o evento chega, a conversão conta, e só a nota de match
 * fica baixa.
 *
 * Duas coisas que só se provam EXECUTANDO:
 *
 * 1. que o `identify` alimenta o Pixel, e não só o `/api/identify`;
 * 2. que os valores vão em CLARO. Quem normaliza e hasheia deste lado é o
 *    fbevents.js — mandar hash faria ele hashear um hash, e o resultado não
 *    casaria com nada. Ler o fonte por string não distingue os dois casos.
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

/** Uma chamada ao fbq, como ela chegou. */
type ChamadaFbq = { metodo: string; alvo: string; dados?: Record<string, unknown> };

type ApiDoSnippet = {
  identify: (dados: Record<string, unknown>) => unknown;
};

type Ambiente = {
  fbq: ChamadaFbq[];
  /** Os `init` que levaram dados — os que de fato configuram matching. */
  initsComDados: () => ChamadaFbq[];
  identify: (dados: Record<string, unknown>) => void;
};

/** Ver a nota do `snippet-produto.test.ts`: a partida é assíncrona. */
async function montar(): Promise<Ambiente> {
  const fbq: ChamadaFbq[] = [];

  const documento = {
    cookie: `_trck=${'a'.repeat(32)}`,
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
    /*
     * O fbq de mentira registra o que RECEBEU. O snippet só o cria quando
     * `w.fbq` não existe; definindo-o aqui, o carregamento do script real é
     * pulado e fica só o que interessa.
     */
    fbq: (metodo: string, alvo: string, dados?: Record<string, unknown>) => {
      fbq.push({ metodo, alvo, dados });
    },
    rrtrack: undefined as ApiDoSnippet | undefined,
    fetch: () =>
      Promise.resolve({
        json: () => Promise.resolve({}),
        clone: () => ({ json: () => Promise.resolve({}) }),
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

  return {
    fbq,
    initsComDados: () =>
      fbq.filter((c) => c.metodo === 'init' && c.dados !== undefined),
    identify: (dados) => {
      janela.rrtrack?.identify(dados);
    },
  };
}

const PESSOA = {
  email: 'Cliente@Exemplo.com',
  phone: '(11) 99999-8888',
  first_name: 'Ana',
  last_name: "O'Brien",
};

describe('advanced matching no Pixel', () => {
  it('a partida inicializa o pixel sem dados — ainda não se sabe quem é', async () => {
    const amb = await montar();

    const inits = amb.fbq.filter((c) => c.metodo === 'init');
    expect(inits).toHaveLength(1);
    expect(inits[0]?.alvo).toBe('111111111111111');
    expect(inits[0]?.dados).toBeUndefined();
  });

  it('o identify alimenta o Pixel, não só o servidor', async () => {
    const amb = await montar();
    amb.identify(PESSOA);

    const comDados = amb.initsComDados();
    expect(comDados).toHaveLength(1);
    expect(comDados[0]?.alvo).toBe('111111111111111');
  });

  it('usa as chaves da Meta, não as nossas', async () => {
    const amb = await montar();
    amb.identify(PESSOA);

    // `email` → `em`, `phone` → `ph`, e assim por diante. Mandar `email`
    // cru o fbevents.js simplesmente ignora, sem reclamar.
    expect(Object.keys(amb.initsComDados()[0]?.dados ?? {}).toSorted()).toEqual([
      'em',
      'fn',
      'ln',
      'ph',
    ]);
  });

  it('manda em CLARO — quem hasheia deste lado é o fbevents.js', async () => {
    const amb = await montar();
    amb.identify(PESSOA);
    const am = amb.initsComDados()[0]?.dados ?? {};

    expect(am.em).toBe('Cliente@Exemplo.com');
    expect(am.ph).toBe('(11) 99999-8888');
    // E nada com cara de SHA-256: hash entregue aqui seria hasheado de novo,
    // e o valor não casaria com nada — falha que não dá erro nenhum.
    for (const valor of Object.values(am)) {
      expect(String(valor)).not.toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('só manda o que veio — campo ausente não vira chave vazia', async () => {
    const amb = await montar();
    amb.identify({ email: 'so@email.com' });

    expect(amb.initsComDados()[0]?.dados).toEqual({ em: 'so@email.com' });
  });

  it('identify sem nada de pessoa não reinicializa o pixel', async () => {
    const amb = await montar();
    amb.identify({ utm_source: 'instagram' });

    // Um init a mais por pageview gastaria trabalho do fbevents.js sem
    // acrescentar sinal nenhum.
    expect(amb.initsComDados()).toHaveLength(0);
  });

  /*
   * `external_id` fica de fora DE PROPÓSITO.
   *
   * O servidor o manda hasheado, e não deu para confirmar na doc da Meta —
   * bloqueada neste ambiente — se o fbevents.js hasheia esse campo ou o
   * trata como id opaco. Se hashear, os dois lados divergiriam, e
   * identificador divergente é pior que ausente.
   *
   * O teste trava a decisão para ela não entrar por engano: quem for
   * acrescentá-la tem de vir aqui, e aí lê o porquê.
   */
  it('NÃO manda external_id enquanto a forma dos dois lados não for a mesma', async () => {
    const amb = await montar();
    amb.identify(PESSOA);

    expect(amb.initsComDados()[0]?.dados).not.toHaveProperty('external_id');
  });
});
