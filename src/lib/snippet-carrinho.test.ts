import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { objeto, texto } from './json';
import { montarSnippet } from './snippet';
import type { Configuracao } from './settings';

/**
 * Este arquivo EXECUTA o snippet contra um DOM de mentira.
 *
 * O assunto é a detecção do carrinho da Shopify — `AddToCart` e
 * `InitiateCheckout` sem ninguém colar nada no tema. Conferir o fonte por
 * string não provaria nada: o que importa é quantos eventos saem, e de qual
 * caminho.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS CAMINHOS PARA A MESMA AÇÃO.                                         │
 * │                                                                          │
 * │ Tema moderno manda `fetch` para /cart/add.js, tema antigo faz submit do  │
 * │ formulário, e alguns fazem os dois. Sem a trava de repetição, uma        │
 * │ adição vira dois ou três AddToCart — e o MEIO DO FUNIL FICA MAIOR QUE O  │
 * │ TOPO, que é o erro que o funil inteiro existe para não cometer.          │
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
  pixels: [],
};

type Enviado = {
  event_name: string;
  custom_data: Record<string, unknown> | undefined;
};

type Ambiente = {
  enviados: Enviado[];
  /** Os caminhos chamados, na ordem — é o que prova a sequência. */
  caminhos: string[];
  /** Dispara um clique com o alvo dado. */
  clicar: (seletor: string) => void;
  /** Dispara um submit de formulário com a `action` dada. */
  submeter: (action: string, nomeDoBotao?: string) => void;
};

function montar(): Ambiente {
  const enviados: Enviado[] = [];
  const caminhos: string[] = [];
  const ouvintes: Record<string, ((e: unknown) => void)[]> = {};

  const documento = {
    cookie: `_trck=${'a'.repeat(32)}`,
    readyState: 'complete',
    activeElement: null as { name?: string } | null,
    querySelectorAll: () => [],
    addEventListener: (tipo: string, fn: (e: unknown) => void) => {
      (ouvintes[tipo] ??= []).push(fn);
    },
    createElement: () => ({ setAttribute: () => {}, style: {} }),
    head: { appendChild: () => {} },
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  };

  /*
   * O `fetch` da janela é o que o snippet embrulha. Ele registra o que foi
   * para o /api/event e devolve resposta vazia para o resto — inclusive para
   * o /cart.js, que o snippet lê sozinho.
   */
  const janela = {
    location: {
      href: 'https://minhaloja.com/produtos/tapete',
      search: '',
      origin: 'https://minhaloja.com',
    },
    document: documento,
    setTimeout: () => 0,
    fetch: (url: string, opcoes?: { body?: string }) => {
      if (url.includes('/api/')) {
        caminhos.push(url.includes('/api/identify') ? '/api/identify' : '/api/event');
      }
      if (url.includes('/api/event') && opcoes?.body) {
        // As guardas de `lib/json.ts` em vez de asserção: é a mesma razão de
        // elas existirem no código de produção — `JSON.parse` devolve `any`,
        // e `any` atravessa qualquer checagem de tipo em silêncio.
        const corpo: unknown = JSON.parse(opcoes.body);
        const nome = texto(corpo, 'event_name');
        if (nome !== undefined) {
          enviados.push({ event_name: nome, custom_data: objeto(corpo, 'custom_data') });
        }
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

  /*
   * `fetch` entra TAMBÉM como global: o `enviar()` do snippet chama `fetch`
   * puro, não `w.fetch`. Sem isto a chamada estoura um ReferenceError que o
   * `seguro()` engole, e o teste vê zero eventos sem dizer por quê.
   */
  const contexto = vm.createContext({
    window: janela,
    document: documento,
    fetch: janela.fetch,
    URL,
    URLSearchParams,
    console,
  });
  vm.runInContext(montarSnippet('https://track.minhaloja.com', CONFIG), contexto);

  function disparar(tipo: string, evento: unknown): void {
    for (const fn of ouvintes[tipo] ?? []) fn(evento);
  }

  return {
    enviados,
    caminhos,
    clicar: (seletor) => {
      disparar('click', {
        target: { closest: (s: string) => (s.includes(seletor) ? {} : null) },
      });
    },
    submeter: (action, nomeDoBotao) => {
      documento.activeElement = nomeDoBotao ? { name: nomeDoBotao } : null;
      disparar('submit', { target: { action } });
    },
  };
}

function nomes(a: Ambiente): string[] {
  return a.enviados.map((e) => e.event_name);
}

/*
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O SNIPPET É GERADO DENTRO DE UM TEMPLATE LITERAL, E ISSO TEM DUAS        │
 * │ ARMADILHAS QUE JÁ MORDERAM TRÊS VEZES NUM DIA:                          │
 * │                                                                          │
 * │ 1. Um backtick num comentário FECHA a string e o arquivo para de         │
 * │    compilar — essa o build pega, e é a menos grave.                      │
 * │ 2. Uma barra escapada numa regex vira barra simples no JavaScript        │
 * │    emitido: `/\/cart/` sai como `//cart`, que é COMENTÁRIO. O build     │
 * │    passa, o snippet sobe, e a detecção some em silêncio na loja do       │
 * │    cliente.                                                              │
 * │                                                                          │
 * │ A segunda é o motivo deste teste existir: ele executa o que foi gerado.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
describe('o que é gerado é JavaScript válido', () => {
  it('não vira comentário nem string quebrada', () => {
    const js = montarSnippet('https://track.minhaloja.com', CONFIG);

    // Compila sem executar: erro de sintaxe estoura aqui.
    expect(() => new vm.Script(js)).not.toThrow();

    // As duas funções que a detecção precisa têm de sobreviver à geração.
    expect(js).toContain('function ehAdicionar');
    expect(js).toContain('function dispararPageView');
  });

  it('o PageView passa pelo track, não por um fbq solto', () => {
    const js = montarSnippet('https://track.minhaloja.com', CONFIG);
    /*
     * Um `fbq('track','PageView')` sem eventID vai só pelo navegador: sem
     * deduplicação, e sem nada quando um bloqueador mata o pixel — que é o
     * problema que este sistema existe para resolver.
     */
    expect(js).not.toContain("fbq('track', 'PageView')");
    expect(js).toContain("api.track('PageView'");
  });
});

describe('PageView', () => {
  /*
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ O PAGEVIEW SAI DEPOIS DA IDENTIFICAÇÃO, E A ORDEM É O TESTE.           │
   * │                                                                        │
   * │ Numa visita nova o cookie ainda não existe: quem o cria é a resposta   │
   * │ do /api/identify. Disparar antes grava o evento sem trck_user_id — e   │
   * │ como a maioria do tráfego de uma loja é visita nova, a maioria dos     │
   * │ PageView nasceria órfã, fora do funil e sem nada para a Meta casar.    │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  it('chega ao /api/event, e depois do identify', async () => {
    const a = montar();
    /*
     * Um turno inteiro do event loop, não N voltas de microtask: a cadeia é
     * fetch → json → then do identificar → then do PageView, e contar os
     * saltos à mão deixaria o teste quebrando a cada refator da cadeia.
     */
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(nomes(a)).toContain('PageView');
    expect(a.caminhos.indexOf('/api/identify')).toBeLessThan(
      a.caminhos.indexOf('/api/event'),
    );
  });
});

describe('detecção do carrinho da Shopify', () => {
  it('o submit do formulário de /cart/add vira AddToCart', () => {
    const a = montar();
    a.submeter('https://minhaloja.com/cart/add');
    expect(nomes(a)).toContain('AddToCart');
  });

  it('o clique no botão de checkout vira InitiateCheckout', () => {
    const a = montar();
    a.clicar('[name="checkout"]');
    expect(nomes(a)).toContain('InitiateCheckout');
  });

  it('o submit com o botão "checkout" também vira InitiateCheckout', () => {
    const a = montar();
    a.submeter('https://minhaloja.com/cart', 'checkout');
    expect(nomes(a)).toContain('InitiateCheckout');
  });

  /*
   * A trava. Tema que faz fetch E submit na mesma adição mandaria dois
   * AddToCart, e o meio do funil ficaria maior que o topo.
   */
  it('dois caminhos na mesma ação disparam UM evento só', () => {
    const a = montar();
    a.submeter('https://minhaloja.com/cart/add');
    a.submeter('https://minhaloja.com/cart/add');
    a.submeter('/cart/add.js');
    expect(nomes(a).filter((n) => n === 'AddToCart')).toHaveLength(1);
  });

  it('o mesmo vale para o checkout', () => {
    const a = montar();
    a.clicar('[name="checkout"]');
    a.clicar('.cart__checkout');
    a.submeter('https://minhaloja.com/cart', 'checkout');
    expect(nomes(a).filter((n) => n === 'InitiateCheckout')).toHaveLength(1);
  });

  /*
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ O ACERTO É PELO CAMINHO DA URL, NUNCA POR BUSCA DE TEXTO.               │
   * │                                                                        │
   * │ Um `indexOf('/cart/add')` casaria com                                  │
   * │ https://golpe.com/?volta=/cart/add — e um link de terceiro na página   │
   * │ passaria a inventar AddToCart no funil de quem olha.                   │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  it('URL de terceiro com /cart/add no meio NÃO dispara', () => {
    const a = montar();
    a.submeter('https://golpe.com/?volta=/cart/add');
    a.submeter('https://golpe.com/cart/add/roubado');
    expect(nomes(a)).not.toContain('AddToCart');
  });

  it('o submit de um formulário qualquer não vira evento nenhum', () => {
    const a = montar();
    a.submeter('https://minhaloja.com/contato');
    a.submeter('https://minhaloja.com/search');
    expect(nomes(a).filter((n) => n === 'AddToCart')).toHaveLength(0);
    expect(nomes(a).filter((n) => n === 'InitiateCheckout')).toHaveLength(0);
  });

  it('o evento leva a moeda configurada', () => {
    const a = montar();
    a.submeter('https://minhaloja.com/cart/add');
    const evento = a.enviados.find((e) => e.event_name === 'AddToCart');
    expect(evento?.custom_data?.currency).toBe('BRL');
  });
});
