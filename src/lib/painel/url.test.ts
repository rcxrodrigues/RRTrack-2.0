import { describe, expect, it } from 'vitest';

import { caminhoDaUrl } from './url';

describe('caminhoDaUrl', () => {
  it('tira o domínio e deixa o caminho', () => {
    expect(caminhoDaUrl('https://transforlar.com/products/tapete-x')).toBe(
      '/products/tapete-x',
    );
  });

  /*
   * A barra solta não identifica a HOME.
   *
   * No meio de `/cart` e `/products/...`, um `/` sozinho foi lido como
   * "deve ser o checkout, área de pagamento" — a porta de entrada da loja
   * identificada pelo caractere menos informativo que existe.
   */
  it('a home vem nomeada, não como uma barra solta', () => {
    expect(caminhoDaUrl('https://transforlar.com/')).toBe('/ (início)');
    expect(caminhoDaUrl('https://transforlar.com')).toBe('/ (início)');
  });

  it('tira a barra do fim para a mesma página não virar duas linhas', () => {
    expect(caminhoDaUrl('https://transforlar.com/cart/')).toBe('/cart');
  });

  it('mantém a query, que distingue variante de produto', () => {
    // Sem ela, `?variant=1` e `?variant=2` já se juntam por serem o mesmo
    // pathname — o que é o certo aqui: a página é a mesma.
    expect(caminhoDaUrl('https://transforlar.com/products/x?variant=99')).toBe(
      '/products/x',
    );
  });

  it('URL torta volta como veio, em vez de sumir da tabela', () => {
    // Página feia se conserta; página que desapareceu ninguém procura.
    expect(caminhoDaUrl('nao-e-url')).toBe('nao-e-url');
  });
});
