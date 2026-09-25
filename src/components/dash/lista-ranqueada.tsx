import { inteiro } from '@/lib/formato';

export type ItemRanqueado = {
  /** A chave do React e o rótulo, quando `rotulo` não vem. */
  id: string;
  rotulo?: string;
  valor: number;
  /** Texto à direita do valor — contexto, não segunda métrica. */
  nota?: string;
  /**
   * Cor da barra, quando os itens são IDENTIDADES e não quantidades.
   *
   * A exceção à regra de uma cor só, e ela tem limite claro: vale quando
   * cada linha é uma coisa diferente (tipo de evento), não quando são a
   * mesma coisa em tamanhos diferentes (região, etapa do funil). No segundo
   * caso o matiz não diria nada que o comprimento já não diga.
   */
  cor?: string;
};

/**
 * Lista ordenada com barra proporcional — um gráfico de barras que cabe numa
 * coluna estreita.
 *
 * **Uma cor só, por padrão.** Os itens costumam ser a mesma grandeza em
 * quantidades diferentes, não identidades: o que os separa é o comprimento.
 * Quando forem identidades de verdade — tipo de evento, por exemplo — cada
 * item pode trazer `cor`, e aí o matiz carrega informação em vez de enfeite. Matiz por item gastaria
 * cinco cores para repetir o que a barra já diz, e acima de sete itens não
 * existe paleta que resolva — por isso o corte é por quantidade de linhas,
 * não por cor.
 *
 * A barra é proporcional ao MAIOR do conjunto, não ao total: numa lista de
 * tipos de evento o total não significa nada, e comparar cada um com o líder
 * é a leitura que interessa.
 */
export function ListaRanqueada({
  itens,
  limite = 8,
  vazio = 'Nada aqui neste período.',
  formatar = inteiro,
}: {
  itens: ItemRanqueado[];
  limite?: number;
  vazio?: string;
  formatar?: (valor: number) => string;
}) {
  if (itens.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{vazio}</p>;
  }

  const visiveis = itens.slice(0, limite);
  const resto = itens.slice(limite);
  const maior = Math.max(...visiveis.map((i) => i.valor), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {visiveis.map((item) => (
        <div key={item.id} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm">{item.rotulo ?? item.id}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              {item.nota && (
                <span className="text-muted-foreground tabular text-xs">
                  {item.nota}
                </span>
              )}
              <span data-slot="metric" className="text-sm font-medium">
                {formatar(item.valor)}
              </span>
            </span>
          </div>
          <div className="bg-muted/50 h-1.5 w-full overflow-hidden rounded-sm">
            <div
              className={item.cor ? 'h-full rounded-r-[4px]' : 'bg-chart-1 h-full rounded-r-[4px]'}
              style={{
                width: `${String(Math.max(1.5, (item.valor / maior) * 100))}%`,
                ...(item.cor ? { backgroundColor: item.cor } : {}),
              }}
            />
          </div>
        </div>
      ))}

      {/*
        O rabo dobrado em "outros", não cortado em silêncio: uma lista que
        esconde linhas sem dizer faz o total da tela não fechar com o total
        do banco, e aí ninguém confia em nenhum dos dois.
      */}
      {resto.length > 0 && (
        <p className="text-muted-foreground pt-1 text-xs">
          + {inteiro(resto.length)} {resto.length === 1 ? 'outro' : 'outros'},
          somando {formatar(resto.reduce((soma, i) => soma + i.valor, 0))}
        </p>
      )}
    </div>
  );
}
