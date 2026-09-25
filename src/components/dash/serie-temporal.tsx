'use client';

import * as React from 'react';

import { inteiro, moeda } from '@/lib/formato';
import { montarGeometria, type Ponto } from '@/lib/painel/serie';
import { cn } from '@/lib/utils';

/**
 * Série temporal de uma métrica só.
 *
 * **Uma cor, sem legenda.** Série única: o título já diz o que está plotado,
 * e uma caixa de legenda com um quadradinho só repetiria o título gastando
 * espaço.
 *
 * O SVG desenha só a área e a linha, com `preserveAspectRatio="none"` para
 * esticar na largura disponível. Marcador e alvo de toque são HTML
 * posicionado em porcentagem — dentro do SVG esticado eles virariam elipses.
 * O `vector-effect` mantém a linha com 2px reais em qualquer largura.
 */

const L = 600;
const A = 160;

/** `2026-09-25` → `25/09`. Derivado do texto, sem passar por `Date`. */
function diaCurto(iso: string): string {
  const [, mes = '', dia = ''] = iso.split('-');
  return `${dia}/${mes}`;
}

/**
 * Como formatar, por NOME e não por função.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Função não atravessa a fronteira servidor→cliente. Passar `formatar` de │
 * │ um Server Component para cá dá "Functions cannot be passed directly to  │
 * │ Client Components" — e não é erro de build só: é a serialização do RSC  │
 * │ que não tem como mandar código.                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O nome viaja, o componente escolhe. `simbolo` vem junto porque a moeda é
 * do gateway, não nossa: a Pagou opera em MXN também.
 */
export type Formato = 'moeda' | 'inteiro';

export function SerieTemporal({
  pontos,
  formato,
  simbolo = 'R$',
  rotulo,
}: {
  pontos: Ponto[];
  formato: Formato;
  simbolo?: string;
  /** O que a linha é — aparece no tooltip, já que não há legenda. */
  rotulo: string;
}) {
  const formatar = (valor: number): string =>
    formato === 'moeda' ? moeda(valor, simbolo) : inteiro(valor);

  const [ativo, setAtivo] = React.useState<number | null>(null);

  if (pontos.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Sem dado no período.
      </p>
    );
  }

  const g = montarGeometria(pontos, L, A);
  const destaque = ativo === null ? g.pontos.at(-1) : g.pontos[ativo];

  return (
    <div className="flex flex-col gap-2">
      {/*
        Calha e quadro como IRMÃOS num flex, não como camadas absolutas.
        Com o SVG posicionado por `left`/`right` ele não ganhava largura
        calculada e caía no tamanho intrínseco do `viewBox` — 600px — que no
        celular escapava do cartão e atravessava a tela. Aqui a largura vem
        do `flex-1`, e todo `%` é relativo só ao quadro.
      */}
      <div className="flex gap-2" style={{ height: `${String(A)}px` }}>
        <div className="relative w-14 shrink-0">
          {g.marcas.map((marca) => (
            <span
              key={`r${String(marca.valor)}`}
              className="text-muted-foreground tabular absolute right-0 -translate-y-1/2 text-right text-[10px] leading-tight"
              style={{ top: `${String((marca.y / A) * 100)}%` }}
            >
              {formatar(marca.valor)}
            </span>
          ))}
        </div>

        <div
          className="relative min-w-0 flex-1"
          onMouseLeave={() => { setAtivo(null); }}
        >
          {/* Grade: um passo de cinza acima do fundo, 1px, sólida. Nunca
              tracejada — tracejado é ruído que compete com o dado. */}
          {g.marcas.map((marca) => (
            <div
              key={marca.valor}
              className="border-border/40 absolute inset-x-0 border-t"
              style={{ top: `${String((marca.y / A) * 100)}%` }}
            />
          ))}

          <svg
            viewBox={`0 0 ${String(L)} ${String(A)}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            {/* Área: a mesma cor a 12% — uma lavagem, nunca bloco saturado. */}
            <path d={g.area} className="fill-chart-1/12" />
            <path
              d={g.linha}
              className="stroke-chart-1 fill-none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Faixas de toque: uma por ponto, largura inteira da coluna. O
              alvo é maior que o marcador de propósito — ponto de 10px é
              impossível de acertar no dedo. */}
          {g.pontos.map((ponto, i) => (
            <button
              key={ponto.dia}
              type="button"
              aria-label={`${diaCurto(ponto.dia)}: ${formatar(ponto.valor)}`}
              onMouseEnter={() => { setAtivo(i); }}
              onFocus={() => { setAtivo(i); }}
              className="absolute top-0 bottom-0"
              style={{
                left: `${String((ponto.x / L) * 100)}%`,
                width: `${String(100 / Math.max(1, g.pontos.length))}%`,
                transform: 'translateX(-50%)',
              }}
            />
          ))}

          {/* Cruzeta e marcador. O anel na cor do cartão é o que mantém o
              ponto legível onde ele cruza a linha. */}
          {destaque && (
            <>
              <div
                className="bg-border/70 pointer-events-none absolute top-0 bottom-0 w-px"
                style={{ left: `${String((destaque.x / L) * 100)}%` }}
              />
              <div
                className="bg-chart-1 ring-card pointer-events-none absolute size-2.5 rounded-full ring-2"
                style={{
                  left: `${String((destaque.x / L) * 100)}%`,
                  top: `${String((destaque.y / A) * 100)}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* O tooltip mora FORA do quadro, numa linha fixa: dentro dele
          precisaria desviar das bordas, e numa faixa de 160px de altura
          taparia o próprio dado. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pl-16 text-xs">
        <span className="text-muted-foreground tabular">
          {diaCurto(g.pontos[0]?.dia ?? '')} — {diaCurto(g.pontos.at(-1)?.dia ?? '')}
        </span>
        {destaque && (
          <span
            className={cn(
              'flex items-baseline gap-2 whitespace-nowrap',
              ativo === null && 'text-muted-foreground',
            )}
          >
            <span className="tabular">{diaCurto(destaque.dia)}</span>
            <span className="text-foreground tabular font-medium">
              {formatar(destaque.valor)}
            </span>
            <span className="text-muted-foreground">{rotulo}</span>
          </span>
        )}
      </div>
    </div>
  );
}
