'use client';

import * as React from 'react';

import { inteiro, moeda, percentual, razao } from '@/lib/formato';
import { VIEWBOX_BRASIL } from '@/lib/painel/mapa-brasil';
import {
  estadosSemAlcance,
  type EstadoPintado,
  type FaixaDoMapa,
} from '@/lib/painel/mapa';
import { cn } from '@/lib/utils';

/**
 * O mapa do Brasil — AO LADO da árvore, nunca no lugar dela.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O QUE ELE RESPONDE QUE A ÁRVORE NÃO RESPONDE: ONDE NÃO TEM NADA.        │
 * │                                                                          │
 * │ Comparar dois tons de verde continua sendo o pior jeito de comparar dois │
 * │ números — isso não mudou, e por isso quem dá o número é a árvore. Mas a  │
 * │ árvore só lista quem APARECEU: um estado de onde nunca veio ninguém não  │
 * │ tem linha nenhuma lá, e portanto é invisível. No mapa ele é um buraco,   │
 * │ e buraco se vê sem procurar.                                             │
 * │                                                                          │
 * │ Numa loja que vende para o Brasil inteiro, "o Norte está apagado" é uma  │
 * │ frase que decide mídia, e nenhuma lista ordenada por receita a diz.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Os tons são os MESMOS da árvore ao lado — verde de receita, azul de
 * visitante. Os dois dividem o cartão, e falar duas línguas de cor a meio
 * metro de distância seria pior que qualquer ganho de consistência com o
 * gráfico de linha, que vive noutro cartão e tem outra restrição (lá o
 * `--success` reprova a banda de luminosidade numa linha de 2px; aqui a
 * marca é uma área, e não reprova).
 */

/**
 * As classes por faixa, escritas por extenso.
 *
 * `fill-${x}` montado em tempo de execução não gera CSS — o Tailwind varre o
 * texto do fonte. Um estado sem regra não dá erro: fica transparente, e o
 * mapa passa a ter um buraco onde havia dado. É a mesma armadilha do gráfico
 * de série, e o `Record<FaixaDoMapa, …>` é o que faz faixa nova sem classe
 * não compilar.
 */
const TONS: Record<FaixaDoMapa, string> = {
  // Ausência de medida. O contorno continua, porque o estado existe — o que
  // não existe é gente dele.
  vazio: 'fill-muted/25',
  // Medida: chegou gente, não comprou ninguém. Azul, como a barra de
  // visitantes da árvore.
  trafego: 'fill-chart-1/30',
  // A rampa de receita: uma cor só, clareando por opacidade. Funciona nos
  // dois temas de graça — sobre o cartão escuro ela vai de fraca a viva,
  // sobre o claro vai de clara a escura, que é a direção certa nos dois.
  r1: 'fill-success/25',
  r2: 'fill-success/45',
  r3: 'fill-success/70',
  r4: 'fill-success/95',
};

export function MapaBrasil({ estados }: { estados: EstadoPintado[] }) {
  const [ufAtiva, setUfAtiva] = React.useState<string | null>(null);

  const ativo = estados.find((e) => e.uf === ufAtiva) ?? null;
  const semAlcance = estadosSemAlcance(estados);

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={VIEWBOX_BRASIL}
        className="h-auto w-full"
        role="group"
        aria-label="Mapa do Brasil por estado"
      >
        {estados.map((estado) => {
          const selecionado = estado.uf === ufAtiva;
          return (
            <path
              key={estado.uf}
              // A sigla no DOM: é por ela que o teste de toque acha o estado
              // sem depender do texto do rótulo, que muda com o dado.
              data-uf={estado.uf}
              d={estado.d}
              role="button"
              tabIndex={0}
              aria-label={rotuloAcessivel(estado)}
              className={cn(
                'cursor-pointer transition-[fill,stroke] outline-none',
                TONS[estado.faixa],
                selecionado
                  ? 'stroke-foreground'
                  : 'stroke-border hover:stroke-foreground/60',
              )}
              strokeWidth={selecionado ? 2 : 1}
              // 1px real em qualquer largura: sem isto a borda engorda junto
              // com o mapa e os estados pequenos viram contorno sólido.
              vectorEffect="non-scaling-stroke"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              /*
                `onClick` e não `onPointerDown`: quem começa a ROLAR a página
                com o dedo em cima do mapa não quis selecionar estado nenhum,
                e o navegador já sabe distinguir as duas coisas — ele suprime
                o clique quando o gesto virou rolagem. No `pointerdown` a
                seleção sairia junto com a rolagem.
              */
              onClick={() => { setUfAtiva(estado.uf); }}
              onPointerEnter={(e) => {
                // Só o mouse pré-visualiza ao passar; o dedo não "passa".
                if (e.pointerType === 'mouse') setUfAtiva(estado.uf);
              }}
              onFocus={() => { setUfAtiva(estado.uf); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setUfAtiva(estado.uf);
                }
              }}
            />
          );
        })}
      </svg>

      {/*
        A linha de detalhe tem altura FIXA e nasce preenchida com a instrução.
        Aparecendo só depois do primeiro toque, ela empurraria a árvore para
        baixo no instante em que a pessoa toca — a mesma regra do esqueleto,
        por outra porta.
      */}
      <div className="border-border/60 min-h-16 rounded-md border px-3 py-2">
        {ativo === null ? (
          <p className="text-muted-foreground text-xs">
            {semAlcance === estados.length ? (
              /*
                Período inteiro vazio. Pedir "toque num estado" aqui seria
                instrução que não pode funcionar — e o mapa todo cinza sem
                uma frase ao lado lê como defeito, não como ausência de
                visita.
              */
              <>
                <strong className="text-foreground">
                  Nenhum visitante com geo no período.
                </strong>{' '}
                O mapa acende conforme a origem das visitas aparece — tente um
                período maior.
              </>
            ) : (
              <>
                Toque num estado para ver os números dele.{' '}
                {semAlcance > 0 && (
                  <>
                    <strong className="text-foreground">
                      {inteiro(semAlcance)} de {inteiro(estados.length)}
                    </strong>{' '}
                    {semAlcance === 1
                      ? 'estado não recebeu nenhum visitante'
                      : 'estados não receberam nenhum visitante'}{' '}
                    no período.
                  </>
                )}
              </>
            )}
          </p>
        ) : (
          <Detalhe estado={ativo} />
        )}
      </div>

      <Legenda />

      {/*
        O crédito da licença. Os contornos são CC BY 4.0, e a licença exige
        atribuição "de maneira razoável para o meio" — num mapa na web, o
        meio é este: uma linha embaixo do mapa, como todo mapa tem. Não é
        enfeite nem excesso de zelo; é a condição de uso do desenho.
      */}
      <p className="text-muted-foreground/70 text-[10px] leading-tight">
        Contornos:{' '}
        <a
          href="https://github.com/VictorCazanave/svg-maps"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-muted-foreground underline underline-offset-2"
        >
          svg-maps
        </a>{' '}
        de Victor Cazanave, simplificados —{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-muted-foreground underline underline-offset-2"
        >
          CC BY 4.0
        </a>
      </p>
    </div>
  );
}

function rotuloAcessivel(estado: EstadoPintado): string {
  if (estado.faixa === 'vazio') return `${estado.nome}: nenhum visitante`;
  const venda =
    estado.receita > 0 ? moeda(estado.receita) : 'nenhuma venda';
  return `${estado.nome}: ${inteiro(estado.visitantes)} visitantes, ${venda}`;
}

function Detalhe({ estado }: { estado: EstadoPintado }) {
  const conversao = razao(estado.aprovadas, estado.visitantes);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{estado.nome}</span>
        <span
          data-slot="metric"
          className={cn(
            'shrink-0 text-sm',
            estado.receita > 0
              ? 'text-success font-semibold'
              : 'text-muted-foreground',
          )}
        >
          {/* Travessão, nunca R$ 0,00 — a mesma regra da árvore. */}
          {estado.receita > 0 ? moeda(estado.receita) : '—'}
        </span>
      </div>
      <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
        {estado.faixa === 'vazio' ? (
          <span>Nenhum visitante no período.</span>
        ) : (
          <>
            <span className="tabular">
              {inteiro(estado.visitantes)}{' '}
              {estado.visitantes === 1 ? 'visitante' : 'visitantes'}
            </span>
            <span className="tabular">
              {inteiro(estado.aprovadas)}{' '}
              {estado.aprovadas === 1 ? 'venda' : 'vendas'}
            </span>
            <span className="tabular">
              conversão{' '}
              {conversao === null ? '—' : percentual(conversao, 2)}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * A legenda, e as três primeiras entradas NÃO são degraus da mesma escala.
 *
 * "Sem visitante" é ausência de medida; "sem venda" é medida. Um pede mídia,
 * o outro pede descobrir por que a oferta não converte ali — problemas
 * opostos que quase todo mapa de painel pinta igual.
 */
function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
      <Item tom="bg-muted/25 border-border border" texto="sem visitante" />
      <Item tom="bg-chart-1/30" texto="visitou, sem venda" />
      <span className="text-muted-foreground flex items-center gap-1.5">
        <span className="flex overflow-hidden rounded-sm">
          <span className="bg-success/25 size-3" />
          <span className="bg-success/45 size-3" />
          <span className="bg-success/70 size-3" />
          <span className="bg-success/95 size-3" />
        </span>
        receita, do menor ao maior
      </span>
    </div>
  );
}

function Item({ tom, texto }: { tom: string; texto: string }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5">
      <span className={cn('size-3 shrink-0 rounded-sm', tom)} />
      {texto}
    </span>
  );
}
