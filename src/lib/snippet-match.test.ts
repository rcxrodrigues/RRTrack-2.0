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
 * Três coisas que só se provam EXECUTANDO:
 *
 * 1. que o `identify` alimenta o Pixel, e não só o `/api/identify`;
 * 2. que e-mail, telefone e nome vão em CLARO (quem hasheia é o
 *    fbevents.js) e que o `external_id` vai HASHEADO, com o hash que o
 *    servidor mandou pronto — a mesma forma dos dois canais, que é o que a
 *    doc de Advanced Matching pede;
 * 3. que os dois momentos ACUMULAM. O site conta o e-mail, a resposta traz
 *    o external_id, e cada um sabe só a sua parte: reinicializando com o
 *    pedaço da vez, o segundo apagaria o primeiro.
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
/** O que o `/api/identify` devolve — hash pronto, calculado no servidor. */
const HASH_DO_SERVIDOR = 'd'.repeat(64);

const PESSOA = {
  email: 'Cliente@Exemplo.com',
  phone: '(11) 99999-8888',
  first_name: 'Ana',
  last_name: "O'Brien",
};

/** Uma chamada ao fbq, como ela chegou. */
type ChamadaFbq = { metodo: string; alvo: string; dados?: Record<string, unknown> };

type ApiDoSnippet = {
  identify: (dados?: Record<string, unknown>) => Promise<unknown>;
};

type Ambiente = {
  fbq: ChamadaFbq[];
  /** Os `init` que levaram dados — os que de fato configuram matching. */
  initsComDados: () => ChamadaFbq[];
  /** O matching como o Pixel o viu por último. */
  ultimoAm: () => Record<string, unknown>;
  /** Como o tema do lojista chama, quando descobre quem é a pessoa. */
  identify: (dados: Record<string, unknown>) => Promise<unknown>;
};

/** Ver a nota do `snippet-produto.test.ts`: a partida é assíncrona. */
async function montar(): Promise<Ambiente> {
  const fbq: ChamadaFbq[] = [];

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
    /*
     * O fbq de mentira registra o que RECEBEU. O snippet só o cria quando
     * `w.fbq` não existe; definindo-o aqui, o carregamento do script real é
     * pulado e fica só o que interessa.
     */
    fbq: (metodo: string, alvo: string, dados?: Record<string, unknown>) => {
      // Cópia: o snippet acumula num objeto só e o reusa a cada init, então
      // guardar a referência faria toda chamada antiga parecer a última.
      fbq.push({ metodo, alvo, dados: dados ? { ...dados } : undefined });
    },
    rrtrack: undefined as ApiDoSnippet | undefined,
    /* A resposta de verdade do /api/identify: id cru + hash pronto. */
    fetch: () =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            ok: true,
            trck_user_id: ID_CRU,
            external_id: HASH_DO_SERVIDOR,
            gravado: true,
          }),
        clone: () => ({
          json: () =>
            Promise.resolve({
              ok: true,
              trck_user_id: ID_CRU,
              external_id: HASH_DO_SERVIDOR,
              gravado: true,
            }),
        }),
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

  // A identificação da partida resolve aqui — é ela que traz o external_id.
  await new Promise((r) => { setTimeout(r, 0); });

  const comDados = (): ChamadaFbq[] =>
    fbq.filter((c) => c.metodo === 'init' && c.dados !== undefined);

  return {
    fbq,
    initsComDados: comDados,
    ultimoAm: () => comDados().at(-1)?.dados ?? {},
    identify: async (dados) => {
      const r = await janela.rrtrack?.identify(dados);
      // O identify faz uma ida à rede; sem esperar, o que a RESPOSTA traz
      // ainda não chegou ao Pixel e o teste leria metade.
      await new Promise((res) => { setTimeout(res, 0); });
      return r;
    },
  };
}

describe('advanced matching no Pixel', () => {
  it('o primeiro init é sem dados — na partida ainda não se sabe quem é', async () => {
    const amb = await montar();

    const inits = amb.fbq.filter((c) => c.metodo === 'init');
    expect(inits[0]?.alvo).toBe('111111111111111');
    expect(inits[0]?.dados).toBeUndefined();
  });

  /*
   * O external_id vem da RESPOSTA do /api/identify, já hasheado.
   *
   * É o mesmo hash que a Conversions API manda, e a doc de Advanced
   * Matching da Meta diz que o Pixel aceita tanto o valor cru quanto o
   * SHA-256 já normalizado — então mandar o mesmo dos dois lados faz os dois
   * casarem, que é o que ela pede quando o id vai por mais de um canal.
   */
  it('a partida já entrega o external_id, sem o site fazer nada', async () => {
    const amb = await montar();

    expect(amb.ultimoAm().external_id).toBe(HASH_DO_SERVIDOR);
  });

  it('não o recalcula: vai exatamente o que o servidor mandou', async () => {
    const amb = await montar();

    // Nem o id cru, nem um hash do hash — o mesmo valor da resposta.
    expect(String(amb.ultimoAm().external_id)).toMatch(/^[0-9a-f]{64}$/);
    expect(amb.ultimoAm().external_id).not.toBe(ID_CRU);
  });

  it('o identify do site alimenta o Pixel, não só o servidor', async () => {
    const amb = await montar();
    await amb.identify(PESSOA);

    expect(amb.ultimoAm().em).toBe('Cliente@Exemplo.com');
  });

  it('usa as chaves da Meta, não as nossas', async () => {
    const amb = await montar();
    await amb.identify(PESSOA);

    // `email` → `em`, `phone` → `ph`. Mandar `email` cru o fbevents.js
    // simplesmente ignora, sem reclamar.
    expect(Object.keys(amb.ultimoAm()).toSorted()).toEqual([
      'em',
      'external_id',
      'fn',
      'ln',
      'ph',
    ]);
  });

  it('e-mail, telefone e nome vão em CLARO — quem hasheia é o fbevents.js', async () => {
    const amb = await montar();
    await amb.identify(PESSOA);
    const am = amb.ultimoAm();

    expect(am.em).toBe('Cliente@Exemplo.com');
    expect(am.ph).toBe('(11) 99999-8888');
    expect(am.ln).toBe("O'Brien");
    // Hash entregue nesses seria hasheado de novo, e não casaria com nada.
    for (const chave of ['em', 'ph', 'fn', 'ln']) {
      expect(String(am[chave])).not.toMatch(/^[0-9a-f]{64}$/);
    }
  });

  /*
   * A ACUMULAÇÃO, que é o ponto fino.
   *
   * Os dois momentos conhecem só a sua parte. Reinicializando com o pedaço
   * da vez, o segundo apagaria o primeiro e o Pixel ficaria sempre com
   * metade do sinal — sem erro nenhum aparecer.
   */
  it('o e-mail do site não apaga o external_id da partida', async () => {
    const amb = await montar();
    await amb.identify(PESSOA);

    const am = amb.ultimoAm();
    expect(am.external_id).toBe(HASH_DO_SERVIDOR);
    expect(am.em).toBe('Cliente@Exemplo.com');
  });

  it('só manda o que veio — campo ausente não vira chave vazia', async () => {
    const amb = await montar();
    await amb.identify({ email: 'so@email.com' });

    expect(amb.ultimoAm()).toEqual({
      external_id: HASH_DO_SERVIDOR,
      em: 'so@email.com',
    });
  });

  it('repetir o mesmo dado não reinicializa o pixel à toa', async () => {
    const amb = await montar();
    await amb.identify(PESSOA);
    const depois = amb.initsComDados().length;
    await amb.identify(PESSOA);

    // Um init a mais por pageview gastaria trabalho do fbevents.js sem
    // acrescentar sinal nenhum.
    expect(amb.initsComDados()).toHaveLength(depois);
  });
});
