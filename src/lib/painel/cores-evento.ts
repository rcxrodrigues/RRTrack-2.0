/**
 * A cor de cada tipo de evento — uma fonte só, para a tela toda.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Cor por tipo só ajuda se for a MESMA cor em todo lugar. Se o PageView    │
 * │ for azul na lista e verde na tabela, a cor deixa de ser atalho e vira   │
 * │ mais uma coisa para conferir.                                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Os tokens são os cinco `--chart-*`, e não cores novas: eles já passaram no
 * validador de banda de luminosidade, piso de croma, separação ΔE e
 * daltonismo, nos dois temas e contra as superfícies reais. Inventar um
 * sexto matiz aqui exigiria revalidar a série inteira — e um matiz escolhido
 * no olho é exatamente o que o `globals.test.ts` existe para impedir.
 *
 * A ORDEM segue o funil, não o alfabeto: quem olha a tela lê de cima para
 * baixo e a cor acompanha o caminho do dinheiro.
 */

/** As três etapas que importam, na ordem do funil. */
const POR_NOME: Record<string, string> = {
  // Topo — a mesma cor do funil e das barras, porque é a mesma quantidade.
  pageview: 'chart-1',
  page_view: 'chart-1',
  viewcontent: 'chart-2',
  view_content: 'chart-2',
  // Meio.
  initiatecheckout: 'chart-3',
  begin_checkout: 'chart-3',
  checkout: 'chart-3',
  iniciarcheckout: 'chart-3',
  addtocart: 'chart-4',
  add_to_cart: 'chart-4',
  lead: 'chart-4',
  // Fim: o dinheiro.
  purchase: 'chart-5',
  compra: 'chart-5',
};

/**
 * Eventos que não estão no mapa ainda precisam de cor — e de cor ESTÁVEL.
 *
 * Sorteio por hash do nome, não por posição na lista: por posição, um evento
 * novo chegando no topo empurraria a cor de todos os outros, e a tela inteira
 * trocaria de cor de um dia para o outro sem nada ter mudado.
 */
function porHash(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i += 1) {
    h = (h * 31 + nome.charCodeAt(i)) % 5;
  }
  return `chart-${String(h + 1)}`;
}

/** O token (`chart-3`), sem o `--` e sem `hsl()`. */
export function tokenDoEvento(nome: string): string {
  return POR_NOME[nome.toLowerCase()] ?? porHash(nome.toLowerCase());
}

/** A cor pronta para `style`, já com o alfa pedido. */
export function corDoEvento(nome: string, alfa = 1): string {
  const token = tokenDoEvento(nome);
  return alfa === 1
    ? `hsl(var(--${token}))`
    : `hsl(var(--${token}) / ${String(alfa)})`;
}
