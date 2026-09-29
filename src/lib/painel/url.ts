/**
 * O caminho da URL, sem o domínio.
 *
 * É ele que identifica a página para quem edita a loja: `/produtos/tapete-x`
 * diz o que é, `https://transforlar.com/produtos/tapete-x` repete o domínio
 * em toda linha e empurra o que interessa para fora da tela no celular.
 *
 * Fica num arquivo só porque duas telas mostram a mesma lista — a aba de
 * Páginas e o resumo da visão geral — e duas cópias divergiriam no dia em
 * que uma delas ganhasse um caso novo.
 */
export function caminhoDaUrl(url: string): string {
  try {
    const u = new URL(url);
    /*
     * A HOME não é uma barra solta.
     *
     * `/` sozinho no meio de `/cart` e `/products/...` não diz nada, e a
     * leitura que chegou foi literalmente "acho que o / deve ser o checkout,
     * área de pagamento". É a linha mais importante da lista — a porta de
     * entrada da loja — identificada pelo caractere menos informativo que
     * existe.
     *
     * "início" não resolveu ("tá com um tal de início que não sei o que é").
     * O nome que as pessoas usam para essa página é PÁGINA INICIAL, e é ele
     * que vai. Rótulo que ainda precisa de explicação não é rótulo.
     */
    if (u.pathname === '/') return '/ (página inicial)';
    return u.pathname.replace(/\/$/, '');
  } catch {
    /*
     * URL que não parseia é dado real que chegou torto — o snippet manda o
     * que o navegador deu. Mostrar como veio é melhor que sumir da tabela:
     * página feia se conserta, página que desapareceu ninguém procura.
     */
    return url;
  }
}
