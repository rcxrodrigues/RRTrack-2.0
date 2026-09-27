import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { objeto, texto } from './json';
import { montarSnippet } from './snippet';
import type { Configuracao } from './settings';

/**
 * Este arquivo EXECUTA o snippet contra um DOM de mentira.
 *
 * Dois assuntos, e os dois erram em silêncio:
 *
 * 1. **`ViewContent` em página de produto.** É o degrau entre ver e pôr no
 *    carrinho, e a Meta otimiza com ele. Faltando, o funil pula de PageView
 *    para AddToCart e o público de remarketing de "viu o produto" não
 *    existe. Detectar demais é pior: um `ViewContent` em toda página faria
 *    a Meta aprender que a home é produto.
 *
 * 2. **O NOME que vai para a gtag.** O funil de comércio eletrônico do GA4
 *    tem nomes próprios (`view_item`, `add_to_cart`), e mandar o nome da
 *    Meta cria um evento CUSTOMIZADO: ele aparece na lista de eventos e não
 *    alimenta relatório nenhum de comércio eletrônico — que é onde a pessoa
 *    vai olhar. Não quebra nada, não avisa nada, e o relatório fica vazio.
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
  ga4: [{ id: 'g1', measurementId: 'G-TESTE123' }],
  pixels: [],
};

type Enviado = {
  event_name: string;
  custom_data: Record<string, unknown> | undefined;
};

/** O que o snippet pendura em `window.rrtrack`. */
type ApiDoSnippet = {
  track: (nome: string, dados: Record<string, unknown>) => void;
};

/** Uma chamada à gtag: o nome que ELA recebeu, não o que a Meta recebeu. */
type ChamadaGtag = { nome: string; dados: Record<string, unknown> };

type Ambiente = {
  enviados: Enviado[];
  gtag: ChamadaGtag[];
  /** Os caminhos chamados, na ordem — é o que prova a sequência. */
  caminhos: string[];
  /** Dispara um evento pela API pública, como o tema do lojista faria. */
  track: (nome: string, dados: Record<string, unknown>) => void;
};

/** O `ShopifyAnalytics.meta.product` que o tema expõe. Nem todo tema expõe. */
type ProdutoDoTema = {
  id: number;
  variants?: { id: number; price: number }[];
  selectedVariantId?: number;
};

/*
 * `async` de propósito, e a razão vale registrar: o PageView e o
 * ViewContent saem no `.then()` do `/api/identify` — é a trava que impede
 * o evento de nascer órfão numa visita nova. Ler `enviados` logo depois do
 * `runInContext` pega o array VAZIO e o teste reprova por engano, dizendo
 * que o evento não dispara quando ele dispara um tique depois.
 */
async function montar(href: string, produto?: ProdutoDoTema): Promise<Ambiente> {
  const enviados: Enviado[] = [];
  const gtag: ChamadaGtag[] = [];
  const caminhos: string[] = [];

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
      href,
      // A query da própria href: o snippet lê `?variant=` daqui.
      search: href.includes('?') ? href.slice(href.indexOf('?')) : '',
      origin: 'https://minhaloja.com',
    },
    document: documento,
    setTimeout: () => 0,
    /*
     * A gtag de mentira registra o nome que RECEBEU. É o único jeito de
     * provar o mapeamento: ler o fonte por string diria que existe um mapa,
     * não que ele é aplicado na chamada.
     */
    gtag: (tipo: string, nome: string, dados: Record<string, unknown>) => {
      if (tipo === 'event') gtag.push({ nome, dados: dados || {} });
    },
    ShopifyAnalytics: produto ? { meta: { product: produto } } : undefined,
    /* O snippet pendura a API aqui; o teste a usa para disparar eventos. */
    rrtrack: undefined as ApiDoSnippet | undefined,
    fetch: (url: string, opcoes?: { body?: string }) => {
      if (url.includes('/api/')) {
        caminhos.push(url.includes('/api/identify') ? '/api/identify' : '/api/event');
      }
      if (url.includes('/api/event') && opcoes?.body) {
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

  const contexto = vm.createContext({
    window: janela,
    document: documento,
    fetch: janela.fetch,
    URL,
    URLSearchParams,
    console,
  });
  vm.runInContext(montarSnippet('https://track.minhaloja.com', CONFIG), contexto);

  // Deixa a fila de microtasks esvaziar: é nela que o PageView e o
  // ViewContent entram, atrás da promessa do identify.
  await new Promise((r) => { setTimeout(r, 0); });

  // Pela API pública de verdade, que é como o tema do lojista chama.
  const track = (nome: string, dados: Record<string, unknown>): void => {
    janela.rrtrack?.track(nome, dados);
  };

  return { enviados, gtag, caminhos, track };
}

function nomes(a: Ambiente): string[] {
  return a.enviados.map((e) => e.event_name);
}

describe('ViewContent — onde dispara e onde NÃO dispara', () => {
  it('dispara na página de produto', async () => {
    const a = await montar('https://minhaloja.com/products/tapete');
    expect(nomes(a)).toContain('ViewContent');
  });

  it('dispara dentro de uma coleção', async () => {
    // /collections/<c>/products/<handle> é a outra forma que a Shopify usa,
    // e é a que o link de uma coleção gera.
    const a = await montar('https://minhaloja.com/collections/casa/products/tapete');
    expect(nomes(a)).toContain('ViewContent');
  });

  it('NÃO dispara na home', async () => {
    expect(nomes(await montar('https://minhaloja.com/'))).not.toContain('ViewContent');
  });

  it('NÃO dispara na listagem de coleção', async () => {
    const a = await montar('https://minhaloja.com/collections/casa');
    expect(nomes(a)).not.toContain('ViewContent');
  });

  it('NÃO dispara em /products/ sem produto nenhum', async () => {
    // A listagem de todos os produtos não é um produto. Disparar ali
    // ensinaria a Meta que uma página de catálogo é uma visualização de
    // item, e o público de remarketing viraria "todo mundo".
    const a = await montar('https://minhaloja.com/products/');
    expect(nomes(a)).not.toContain('ViewContent');
  });

  it('NÃO se deixa enganar por /products/ na QUERY de um link de terceiro', async () => {
    /*
     * A checagem é no CAMINHO, nunca no href. Um indexOf no href casaria
     * com uma URL montada por outra pessoa — é a mesma armadilha que a
     * marcação de checkout evita, por outra porta.
     */
    const a = await montar('https://minhaloja.com/?volta=/products/tapete');
    expect(nomes(a)).not.toContain('ViewContent');
  });

  it('sai UMA vez, não duas', async () => {
    const a = await montar('https://minhaloja.com/products/tapete');
    expect(nomes(a).filter((n) => n === 'ViewContent')).toHaveLength(1);
  });

  it('sai DEPOIS do /api/identify', async () => {
    // Numa visita nova o _trck ainda não existe — quem o cria é a resposta
    // do identify. Disparar antes gravaria o evento órfão, e a maioria do
    // tráfego de uma loja é visita nova.
    const a = await montar('https://minhaloja.com/products/tapete');
    expect(a.caminhos[0]).toBe('/api/identify');
  });
});

describe('ViewContent — o que ele leva', () => {
  it('leva content_ids e o preço em REAIS quando o tema expõe o produto', async () => {
    // A Shopify manda preço em CENTAVOS. Mandar 8990 como valor viraria
    // R$ 8.990,00 num produto de R$ 89,90 — erro de 100× que a Meta aceita
    // calada e que só aparece num ROAS absurdo semanas depois.
    const a = await montar('https://minhaloja.com/products/tapete', {
      id: 777,
      variants: [{ id: 1, price: 8990 }],
    });
    const evento = a.enviados.find((e) => e.event_name === 'ViewContent');
    expect(evento?.custom_data?.content_ids).toEqual(['777']);
    expect(evento?.custom_data?.value).toBe(89.9);
    expect(evento?.custom_data?.content_type).toBe('product');
  });

  it('usa a variante DA PÁGINA, não a primeira da lista', async () => {
    /*
     * ┌───────────────────────────────────────────────────────────────────┐
     * │ variants[0] MANDA SEMPRE O MAIS BARATO.                           │
     * │                                                                   │
     * │ Numa camiseta P/M/G por 89,90 / 109,90 / 129,90, quem abre a GG   │
     * │ gerava um ViewContent de R$ 89,90. A otimização por valor da Meta │
     * │ aprende com esse número, e a coluna de valor do Events Manager    │
     * │ passa a não bater com a página — sem erro nenhum aparecer.        │
     * └───────────────────────────────────────────────────────────────────┘
     */
    const a = await montar(
      'https://minhaloja.com/products/camiseta?variant=333',
      {
        id: 777,
        variants: [
          { id: 111, price: 8990 },
          { id: 222, price: 10990 },
          { id: 333, price: 12990 },
        ],
      },
    );
    const evento = a.enviados.find((e) => e.event_name === 'ViewContent');
    expect(evento?.custom_data?.value).toBe(129.9);
  });

  it('sem ?variant=, a primeira é a resposta certa e não um palpite', async () => {
    // É a que a Shopify mostra quando a URL não escolhe.
    const a = await montar('https://minhaloja.com/products/camiseta', {
      id: 777,
      variants: [
        { id: 111, price: 8990 },
        { id: 222, price: 10990 },
      ],
    });
    const evento = a.enviados.find((e) => e.event_name === 'ViewContent');
    expect(evento?.custom_data?.value).toBe(89.9);
  });

  it('preço ZERO vai como 0, não some', async () => {
    // Brinde e amostra grátis valem R$ 0,00. O teste falsy jogava o campo
    // fora — a mesma armadilha do zero que o painel evita nos custos.
    const a = await montar('https://minhaloja.com/products/brinde', {
      id: 900,
      variants: [{ id: 1, price: 0 }],
    });
    const evento = a.enviados.find((e) => e.event_name === 'ViewContent');
    expect(evento?.custom_data?.value).toBe(0);
  });

  it('SAI MESMO SEM o tema expor o produto', async () => {
    /*
     * Nem todo tema tem ShopifyAnalytics. Um evento sem content_ids ainda
     * ensina a Meta QUEM olhou — e um evento a menos não ensina nada.
     * Exigir o produto aqui trocaria um dado incompleto por dado nenhum.
     */
    const a = await montar('https://minhaloja.com/products/tapete');
    const evento = a.enviados.find((e) => e.event_name === 'ViewContent');
    expect(evento).toBeDefined();
    expect(evento?.custom_data?.content_ids).toBeUndefined();
    expect(evento?.custom_data?.currency).toBe('BRL');
  });
});

describe('o nome que vai para a gtag é o do GA4, não o da Meta', () => {
  it('ViewContent vira view_item', async () => {
    const a = await montar('https://minhaloja.com/products/tapete');
    const chamados = a.gtag.map((c) => c.nome);
    expect(chamados).toContain('view_item');
    // O nome da Meta NÃO pode aparecer do lado do GA4: ali ele seria um
    // evento customizado, fora de todo relatório de comércio eletrônico.
    expect(chamados).not.toContain('ViewContent');
  });

  it('o CORPO vira items[], não content_ids', async () => {
    /*
     * ┌───────────────────────────────────────────────────────────────────┐
     * │ O NOME CERTO COM O CORPO ERRADO É CONSERTO NENHUM.                │
     * │                                                                   │
     * │ Os relatórios de comércio eletrônico do GA4 se alimentam de       │
     * │ `items[]`. `content_ids` e `content_type` são vocabulário da      │
     * │ Meta, e o GA4 descarta. Mandar `view_item` com content_ids deixa  │
     * │ o evento na lista e a tela de Monetização EM BRANCO — a mesma     │
     * │ falha silenciosa que trocar o nome existia para resolver.         │
     * └───────────────────────────────────────────────────────────────────┘
     */
    const a = await montar('https://minhaloja.com/products/tapete', {
      id: 777,
      variants: [{ id: 1, price: 8990 }],
    });
    const viewItem = a.gtag.find((c) => c.nome === 'view_item');

    expect(viewItem?.dados.items).toEqual([
      { item_id: '777', price: 89.9, quantity: 1 },
    ]);
    expect(viewItem?.dados.content_ids).toBeUndefined();
    expect(viewItem?.dados.content_type).toBeUndefined();
    // A moeda e o valor continuam: esses o GA4 entende.
    expect(viewItem?.dados.currency).toBe('BRL');
    expect(viewItem?.dados.value).toBe(89.9);
  });

  it('a Meta continua recebendo content_ids, intacto', async () => {
    // A tradução é SÓ do lado do GA4. O events_log e o fbq recebem o
    // vocabulário da Meta — trocar os dois quebraria o outro destino.
    const a = await montar('https://minhaloja.com/products/tapete', {
      id: 777,
      variants: [{ id: 1, price: 8990 }],
    });
    const evento = a.enviados.find((e) => e.event_name === 'ViewContent');
    expect(evento?.custom_data?.content_ids).toEqual(['777']);
    expect(evento?.custom_data?.items).toBeUndefined();
  });

  it('o PageView continua fora do GA4', async () => {
    // A gtag já manda page_view sozinha no config. Um segundo evento
    // mediria a mesma coisa duas vezes.
    const a = await montar('https://minhaloja.com/products/tapete');
    expect(a.gtag.map((c) => c.nome)).not.toContain('page_view');
  });

  it('o evento sem par no GA4 vai com o nome que veio', async () => {
    /*
     * Este teste era VAZIO: ele só olhava as chamadas da própria página, e
     * a única delas (view_item) está no mapa — então passava mesmo se o
     * `|| nome` fosse apagado, que é exatamente o caso que ele dizia cobrir.
     * Agora ele dispara um evento fora do mapa de verdade.
     */
    const a = await montar('https://minhaloja.com/products/tapete');
    a.track('Lead', { value: 97 });
    await new Promise((r) => { setTimeout(r, 0); });

    expect(a.gtag.map((c) => c.nome)).toContain('Lead');
  });

  it('nome que colide com o prototipo NÃO vira função', async () => {
    /*
     * `rrtrack.track` recebe o nome de quem chama, na página do lojista.
     * Com `NOME_GA4[nome] || nome`, `track('constructor')` acharia a função
     * herdada de Object.prototype — verdadeira — e ela iria como NOME do
     * evento para a gtag. `hasOwnProperty` fecha isso.
     */
    const a = await montar('https://minhaloja.com/products/tapete');
    a.track('constructor', {});
    await new Promise((r) => { setTimeout(r, 0); });

    const oConstructor = a.gtag.find((c) => c.nome === 'constructor');
    expect(oConstructor).toBeDefined();
    expect(a.gtag.every((c) => typeof c.nome === 'string')).toBe(true);
  });
});
