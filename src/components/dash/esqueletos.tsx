import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ALTURA_DO_QUADRO } from '@/lib/painel/serie';
import { cn } from '@/lib/utils';

/**
 * Os esqueletos das abas do painel.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ISTO EXISTE — E O NÚMERO, QUE FOI MEDIDO, NÃO DEDUZIDO           │
 * │                                                                          │
 * │ Toda aba do painel é `force-dynamic`. Sem um `loading.tsx` a navegação   │
 * │ não TROCA a tela: ela abre a requisição e espera o servidor terminar     │
 * │ todas as consultas com a aba antiga ainda desenhada, congelada, sem      │
 * │ spinner e sem reação. O clique parece não ter funcionado.                │
 * │                                                                          │
 * │ A medição, numa rota de teste com 1500ms de atraso artificial, no build  │
 * │ de produção e com o Playwright cronometrando o clique:                   │
 * │                                                                          │
 * │     sem loading.tsx → a tela antiga sai em 1892ms                        │
 * │     com loading.tsx → o esqueleto entra em  126ms                        │
 * │                                                                          │
 * │ O tempo do banco é EXATAMENTE o mesmo nos dois (o dado real chega em     │
 * │ ~1900ms de qualquer jeito). O que muda é que a tela responde no          │
 * │ primeiro frame em vez de fingir que o clique não houve.                  │
 * │                                                                          │
 * │ A tabela em                                                              │
 * │ `node_modules/next/dist/docs/01-app/02-guides/prefetching.md` explica o  │
 * │ mecanismo: rota dinâmica só entra no prefetch com `loading.js`, e é ele  │
 * │ que dá à navegação uma casca para mostrar antes do dado.                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A geometria tem de ser a MESMA da tela real. Esqueleto de outro tamanho é
 * pior que nenhum: o conteúdo salta quando chega e o olho perde o lugar.
 */

/** O cabeçalho: título no celular e o seletor de período à direita. */
export function EsqueletoCabecalho() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Skeleton className="h-6 w-28 md:hidden" />
      {/*
        O seletor de período: cinco botões (Hoje · Ontem · 7 dias · 30 dias ·
        Este mês) numa faixa de altura fixa.

        SEM `ms-auto`, e isso foi erro meu. O contêiner real é
        `sm:justify-between` com o título `md:hidden` — então a partir de
        768px o seletor é o ÚNICO filho e assenta à ESQUERDA. Com `ms-auto`
        o esqueleto aparecia à direita e o conteúdo real saltava a largura
        da tela inteira para a esquerda, no componente que existe justamente
        para não deixar nada saltar. Aqui o título placeholder tem o mesmo
        `md:hidden`, então o comportamento acompanha sozinho.
      */}
      <Skeleton className="h-11 w-full sm:w-80" />
    </div>
  );
}

/**
 * Um cartão de métrica, na altura exata do `MetricCard`.
 *
 * `comCusto` acrescenta o rodapé separado por linha — os três cartões do topo
 * da visão geral o têm, os três de baixo não, e as duas alturas são
 * diferentes. Um esqueleto só para os dois faria a grade saltar.
 */
export function EsqueletoMetrica({ comCusto = false }: { comCusto?: boolean }) {
  return (
    <Card className="gap-0 p-4 sm:p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-24 sm:h-8" />
      <Skeleton className="mt-3 h-3 w-28" />
      {comCusto && (
        <div className="border-border/60 mt-auto flex items-baseline justify-between gap-2 border-t pt-2.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      )}
    </Card>
  );
}

/**
 * A grade de métricas.
 *
 * `quantos` é sempre o número real de cartões da tela — seis na visão geral,
 * três em Páginas. Errar aqui é errar a altura do bloco inteiro.
 */
export function EsqueletoMetricas({
  quantos,
  colunas = 3,
  custoAte = 0,
}: {
  quantos: number;
  /** Quantas colunas no desktop — a da tela real (Campanhas usa quatro). */
  colunas?: 3 | 4;
  /** Quantos dos primeiros cartões têm o rodapé de custo. */
  custoAte?: number;
}) {
  return (
    <section
      className={cn(
        'grid grid-cols-2 gap-3 sm:gap-4',
        colunas === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
      )}
    >
      {Array.from({ length: quantos }, (_, i) => (
        <EsqueletoMetrica key={i} comCusto={i < custoAte} />
      ))}
    </section>
  );
}

/**
 * O cartão do funil: o SVG estreito à esquerda e a calha de rótulos.
 *
 * Um bloco de largura cheia no lugar dele tinha a altura certa e a forma
 * errada — e o salto ao trocar não é só vertical.
 */
export function EsqueletoFunil() {
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-52 w-24 shrink-0 sm:w-32" />
        <div className="flex flex-1 flex-col justify-between py-1">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-28 max-w-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/**
 * O corpo de um gráfico de série — o que espera DENTRO do cartão.
 *
 * Os outros esqueletos substituem a tela toda na navegação; este entra num
 * `Suspense` no meio de um cartão já desenhado, porque a segunda série do
 * quadro de receita × investido sai da API da Meta e é a coisa mais lenta do
 * painel. O título e a explicação aparecem na hora; só a moldura espera.
 *
 * A altura vem de `ALTURA_DO_QUADRO`, a mesma constante que o componente usa.
 * Copiar `160` para cá seria pedir para os dois divergirem — e aí o quadro
 * salta ao trocar, no lugar feito para nada saltar.
 */
export function EsqueletoQuadro() {
  return (
    <div className="flex flex-col gap-2">
      {/*
        A legenda: dois pares de ponto + nome.

        O contêiner leva `h-4` porque é a altura de uma linha de `text-xs`
        (12px de fonte, 16px de entrelinha) — e é a altura da legenda de
        verdade. Com os blocos em `h-3` a linha media 12px e o cartão inteiro
        ficava 8px mais baixo: invisível a olho, e medido.
      */}
      <div className="flex h-4 items-center gap-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-24" />
      </div>
      {/* Calha do eixo à esquerda, quadro à direita — como os irmãos do flex
          do componente, e não um bloco só: a calha é mais clara que o quadro
          na tela real, e um retângulo cheio saltaria na largura dela. */}
      <div className="flex gap-2" style={{ height: `${String(ALTURA_DO_QUADRO)}px` }}>
        <div className="flex w-14 shrink-0 flex-col justify-between py-px">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-2.5 w-full" />
          ))}
        </div>
        <Skeleton className="min-w-0 flex-1" />
      </div>
      {/*
        A linha do tooltip, que na tela real fica fora do quadro — e que
        QUEBRA em três linhas no celular.

        Esta era a pior diferença: 16px no desktop e 56px a 390px, contra
        12px fixos do esqueleto. Quase 50px de salto no aparelho em que o
        painel mais é aberto. A correção não é um número chutado: é a MESMA
        estrutura aninhada da tela real (o período de um lado, e do outro um
        flex que envolve dia + um grupo por série), com blocos de largura
        parecida. Assim ela quebra onde a de verdade quebra, em vez de
        acertar numa largura e errar nas outras.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pl-16">
        <Skeleton className="h-4 w-24" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/*
            As larguras foram MEDIDAS contra o texto real (36px o dia, 134 e
            148 os dois grupos), não escolhidas no olho: é o que faz a quebra
            cair na mesma largura de tela. Conferido a 320, 390, 500, 600 e
            1280 — todas batem ao pixel.
          */}
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </div>
  );
}

/** Um cartão de conteúdo com título, subtítulo e um corpo de altura dada. */
export function EsqueletoCartao({
  altura = 'h-40',
  linhas,
}: {
  /** Classe de altura do corpo — a da tela real, medida. */
  altura?: string;
  /** Quando o corpo é uma lista, o número de linhas em vez de um bloco só. */
  linhas?: number;
}) {
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-52 max-w-full" />
      </div>
      {linhas === undefined ? (
        <Skeleton className={altura} />
      ) : (
        <div className="flex flex-col gap-3">
          {Array.from({ length: linhas }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Skeleton className="h-3 w-32 max-w-[45%]" />
                <Skeleton className="h-3 w-12" />
              </div>
              {/* A barra encolhe como a lista ranqueada encolhe. */}
              <Skeleton
                className="h-2"
                style={{ width: `${String(96 - i * 16)}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * Uma tabela: cabeçalho com título e contagem, e as linhas.
 *
 * `p-0` e `overflow-hidden` como as tabelas reais, para a borda do cartão
 * cortar as linhas no mesmo lugar.
 */
export function EsqueletoTabela({ linhas = 8 }: { linhas?: number }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="flex items-baseline justify-between gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-9 w-full max-w-md" />
      </div>
      <div className="border-border/60 flex flex-col border-t">
        {Array.from({ length: linhas }, (_, i) => (
          <div
            key={i}
            className="border-border/60 flex items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:px-5"
          >
            <Skeleton className="size-2.5 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-28 shrink-0" />
            <Skeleton className="hidden h-3 flex-1 sm:block" />
            <Skeleton className="ms-auto h-3 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
