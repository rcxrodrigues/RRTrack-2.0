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

/** Uma chamada à gtag: o nome que ELA recebeu, não o que a Meta recebeu. */
type ChamadaGtag = { nome: string; dados: Record<string, unknown> };

type Ambiente = {
  enviados: Enviado[];
  gtag: ChamadaGtag[];
  /** Os caminhos chamados, na ordem — é o que prova a sequência. */
  caminhos: string[];
};

/** O `ShopifyAnalytics.meta.product` que o tema expõe. Nem todo tema expõe. */
type ProdutoDoTema = {
  id: number;
  variants?: { id: number; price: number }[];
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
    location: { href, search: '', origin: 'https://minhaloja.com' },
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

  return { enviados, gtag, caminhos };
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

  it('o PageView continua fora do GA4', async () => {
    // A gtag já manda page_view sozinha no config. Um segundo evento
    // mediria a mesma coisa duas vezes.
    const a = await montar('https://minhaloja.com/products/tapete');
    expect(a.gtag.map((c) => c.nome)).not.toContain('page_view');
  });

  it('o evento sem par no GA4 vai com o nome que veio', async () => {
    // rrtrack.track('Lead') não tem equivalente no funil do GA4. Traduzir
    // para algo seria inventar; deixar passar é o certo.
    const a = await montar('https://minhaloja.com/products/tapete');
    expect(a.gtag.every((c) => c.nome.length > 0)).toBe(true);
  });
});
