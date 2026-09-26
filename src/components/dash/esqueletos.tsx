import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
        Este mês) numa faixa de altura fixa. No celular ele ocupa a largura
        toda; no desktop encolhe e vai para a direita, como o de verdade.
      */}
      <Skeleton className="h-11 w-full sm:ms-auto sm:w-80" />
    </div>
  );
}

/** Um cartão de métrica, na altura exata do `MetricCard`. */
export function EsqueletoMetrica() {
  return (
    <Card className="gap-0 p-4 sm:p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-24 sm:h-8" />
      <Skeleton className="mt-3 h-3 w-28" />
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
}: {
  quantos: number;
  /** Quantas colunas no desktop — a da tela real (Campanhas usa quatro). */
  colunas?: 3 | 4;
}) {
  return (
    <section
      className={cn(
        'grid grid-cols-2 gap-3 sm:gap-4',
        colunas === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
      )}
    >
      {Array.from({ length: quantos }, (_, i) => (
        <EsqueletoMetrica key={i} />
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
