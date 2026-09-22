import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { montarSnippet } from './snippet';
import type { Configuracao, DominioCheckout } from './settings';

/**
 * Este arquivo EXECUTA o snippet, ao contrário do `snippet.test.ts`, que só
 * confere o texto dele.
 *
 * A diferença importa: quem decide para qual domínio o identificador do
 * visitante viaja é a marcação de links. Procurar uma string no fonte não
 * prova nada sobre isso — e um acerto de domínio frouxo manda o vínculo da
 * venda para o site errado.
 */

const ID = 'a'.repeat(32);

/** `'dominio'` ou `'dominio|parametro'`, como o cadastro do painel guarda. */
function comoDominio(entrada: string): DominioCheckout {
  const [dominio = '', parametro = ''] = entrada.split('|');
  return { dominio, parametro: parametro || 'trck_user_id' };
}

function configCom(checkout: string[]): Configuracao {
  return {
    settings: {
      currency: 'BRL',
      testEventCode: null,
      cookieDomain: '.minhaloja.com',
      origensPermitidas: ['https://minhaloja.com'],
      dominiosCheckout: checkout.map(comoDominio),
    },
    ga4: [],
    pixels: [],
  };
}

type Ancora = { href: string };

/**
 * Roda o snippet contra um DOM de mentira e devolve os links como ficaram.
 *
 * O stub é o mínimo que o snippet toca; qualquer coisa a mais seria fingir
 * um navegador para não testar nada melhor.
 */
function marcar(hrefs: string[], checkout: string[]): Ancora[] {
  const ancoras = hrefs.map((href) => {
    const a = {
      href,
      getAttribute: (nome: string) => (nome === 'href' ? a.href : null),
      setAttribute: (nome: string, valor: string) => {
        if (nome === 'href') a.href = valor;
      },
    };
    return a;
  });

  const documento = {
    cookie: `_trck=${ID}`,
    readyState: 'complete',
    querySelectorAll: () => ancoras,
    addEventListener: () => {},
    createElement: () => ({ setAttribute: () => {}, style: {} }),
    head: { appendChild: () => {} },
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  };

  const janela = {
    location: { href: 'https://minhaloja.com/produto', search: '' },
    document: documento,
    setTimeout: () => 0,
    // O identify dispara na partida e não é o assunto aqui; uma promessa que
    // nunca resolve basta para ele não atrapalhar.
    fetch: () => new Promise(() => {}),
    URL,
    URLSearchParams,
    crypto: { randomUUID: () => 'id-de-teste-0001' },
  };

  const contexto = vm.createContext({
    window: janela,
    document: documento,
    URL,
    URLSearchParams,
    console,
  });

  vm.runInContext(montarSnippet('https://track.minhaloja.com', configCom(checkout)), contexto);

  return ancoras.map((a) => ({ href: a.href }));
}

describe('marcação de links de checkout', () => {
  it('pendura o identificador no domínio cadastrado', () => {
    const [link] = marcar(['https://seguro.minhaloja.com/pedido/42'], ['seguro.minhaloja.com']);
    expect(link?.href).toContain(`trck_user_id=${ID}`);
  });

  it('vale também para subdomínio do domínio cadastrado', () => {
    const [link] = marcar(['https://br.checkout.yampi.com.br/x'], ['checkout.yampi.com.br']);
    expect(link?.href).toContain(`trck_user_id=${ID}`);
  });

  it('não toca em link de domínio não cadastrado', () => {
    const [link] = marcar(['https://instagram.com/minhaloja'], ['seguro.minhaloja.com']);
    expect(link?.href).toBe('https://instagram.com/minhaloja');
  });

  /*
   * O acerto é por HOST. Com uma busca de texto no href — que foi como isto
   * nasceu — os três links abaixo passariam, e o identificador do visitante
   * iria parar no domínio de quem montou o link.
   */
  it('NÃO cai em domínio que só CONTÉM o do checkout', () => {
    const casos = [
      'https://golpe.com/?volta=seguro.minhaloja.com',
      'https://seguro.minhaloja.com.golpe.com/pedido',
      'https://naoseguro.minhaloja.com.br/pedido',
    ];
    for (const href of casos) {
      const [link] = marcar([href], ['seguro.minhaloja.com']);
      expect(link?.href, href).toBe(href);
    }
  });

  it('no WhatsApp o id vai no TEXTO, não na query', () => {
    const [link] = marcar(['https://wa.me/5511999998888?text=Quero%20comprar'], []);
    expect(link?.href).toContain(`%5B%23${ID}%5D`);
    expect(link?.href).not.toContain('trck_user_id=');
  });

  // O WhatsApp não depende de cadastro: é universal e não muda por oferta.
  it('marca o WhatsApp mesmo sem nenhum checkout cadastrado', () => {
    const [link] = marcar(['https://api.whatsapp.com/send?phone=551199999'], []);
    expect(link?.href).toContain(ID);
  });

  it('não marca duas vezes', () => {
    const jaMarcado = `https://seguro.minhaloja.com/x?trck_user_id=${ID}`;
    const [link] = marcar([jaMarcado], ['seguro.minhaloja.com']);
    expect(link?.href).toBe(jaMarcado);
  });

  it('sem domínio cadastrado, nenhum link de checkout é marcado', () => {
    const [link] = marcar(['https://seguro.minhaloja.com/pedido'], []);
    expect(link?.href).toBe('https://seguro.minhaloja.com/pedido');
  });
});

/*
 * O nome do parâmetro por checkout.
 *
 * Confirmado pelo suporte da Yampi em 22/09/2026: ela só aceita
 * `metadata[trck_user_id]`, e ignora qualquer outro nome. Ignorar não dá
 * erro — o link vai, a compra acontece, e o webhook chega sem o vínculo.
 * A venda entra no faturamento e some do ROAS por campanha, que é o
 * produto. Por isso estas asserções EXECUTAM o snippet.
 */
describe('o parâmetro é o que o checkout aceita, não um nome fixo', () => {
  const YAMPI = 'seguro.minhaloja.com|metadata[trck_user_id]';

  it('usa o nome cadastrado no lugar do padrão', () => {
    const [link] = marcar(['https://seguro.minhaloja.com/checkout'], [YAMPI]);
    expect(link?.href).toContain(`metadata[trck_user_id]=${ID}`);
    // E não o nome que a Yampi ignoraria.
    expect(link?.href).not.toContain(`?trck_user_id=${ID}`);
    expect(link?.href).not.toContain(`&trck_user_id=${ID}`);
  });

  it('manda o colchete LITERAL, não escapado', () => {
    // O URLSearchParams escaparia para metadata%5Btrck_user_id%5D. A doc da
    // Yampi mostra a forma literal, e é ela que devolvemos — em vez de
    // apostar que o servidor deles decodifica antes de montar o array.
    const [link] = marcar(['https://seguro.minhaloja.com/checkout'], [YAMPI]);
    expect(link?.href).not.toContain('%5B');
    expect(link?.href).not.toContain('%5D');
  });

  it('preserva o que já estava na query', () => {
    const [link] = marcar(
      ['https://seguro.minhaloja.com/checkout?cupom=OFF10'],
      [YAMPI],
    );
    expect(link?.href).toContain('cupom=OFF10');
    expect(link?.href).toContain(`metadata[trck_user_id]=${ID}`);
  });

  it('não marca duas vezes o parâmetro customizado', () => {
    const jaMarcado = `https://seguro.minhaloja.com/x?metadata[trck_user_id]=${ID}`;
    const [link] = marcar([jaMarcado], [YAMPI]);
    expect(link?.href).toBe(jaMarcado);
  });

  it('não desescapa colchete do VALOR de outro parâmetro', () => {
    // A troca é só da chave escapada seguida de "=". Desescapar o href
    // inteiro mexeria em valor alheio — e um checkout que recebesse um
    // colchete cru onde esperava escapado poderia recusar o pedido.
    const [link] = marcar(
      ['https://seguro.minhaloja.com/x?nota=%5Burgente%5D'],
      [YAMPI],
    );
    expect(link?.href).toContain('nota=%5Burgente%5D');
    expect(link?.href).toContain(`metadata[trck_user_id]=${ID}`);
  });

  it('cada domínio usa o SEU parâmetro, não o do vizinho', () => {
    const links = marcar(
      ['https://seguro.minhaloja.com/x', 'https://pay.outraloja.com/y'],
      [YAMPI, 'pay.outraloja.com|src'],
    );
    expect(links[0]?.href).toContain('metadata[trck_user_id]=');
    expect(links[1]?.href).toContain(`src=${ID}`);
    expect(links[1]?.href).not.toContain('metadata');
  });

  it('sem o `|`, continua valendo o trck_user_id', () => {
    const [link] = marcar(['https://seguro.minhaloja.com/x'], ['seguro.minhaloja.com']);
    expect(link?.href).toContain(`trck_user_id=${ID}`);
  });
});
