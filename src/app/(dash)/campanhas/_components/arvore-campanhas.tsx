'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { inteiro, moeda, percentual, razao } from '@/lib/formato';
import type { NoDaArvore } from '@/lib/painel/arvore';

/**
 * A árvore campanha → conjunto → anúncio, como no gerenciador da Meta.
 *
 * Fechada por padrão: uma conta com trinta campanhas e trezentos anúncios
 * aberta de uma vez não é visão nenhuma. Quem abre uma campanha está
 * perguntando dela.
 *
 * O recuo é a única marca de hierarquia — sem linha-guia, sem cor por nível.
 * Três níveis não precisam de mais que isso, e cor por nível brigaria com a
 * cor do ROAS, que é a que carrega informação aqui.
 */

const ROTULO_DO_NIVEL = ['campanha', 'conjunto', 'anúncio'] as const;

export function ArvoreCampanhas({ raizes }: { raizes: NoDaArvore[] }) {
  if (raizes.length === 0) {
    return (
      <p className="text-muted-foreground border-border/60 border-t px-4 py-10 text-center text-sm sm:px-5">
        Nenhuma campanha com gasto no período.
      </p>
    );
  }

  return (
    <div className="border-border/60 border-t">
      {raizes.map((no) => (
        <No key={no.id} no={no} />
      ))}
    </div>
  );
}

function No({ no }: { no: NoDaArvore }) {
  const [aberto, setAberto] = React.useState(false);
  const temFilhos = no.filhos.length > 0;

  const ctr = razao(no.cliques, no.impressoes);
  const divergente =
    no.receitaDaMeta > 0 &&
    Math.abs(no.receitaDaMeta - no.receita) / no.receitaDaMeta > 0.1;

  return (
    <>
      <div
        className="border-border/60 border-b last:border-0"
        // O recuo cresce com o nível. `padding` e não `margin`: a linha
        // divisória tem de atravessar a largura inteira, senão a lista vira
        // degrau e fica difícil seguir com o olho.
        style={{ paddingLeft: `${String(no.nivel * 1.25)}rem` }}
      >
        <button
          type="button"
          onClick={() => { setAberto((v) => !v); }}
          aria-expanded={temFilhos ? aberto : undefined}
          disabled={!temFilhos}
          className="hover:bg-muted/40 flex min-h-11 w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors disabled:hover:bg-transparent sm:px-5"
        >
          <div className="flex w-full items-baseline gap-2">
            {temFilhos ? (
              aberto ? (
                <ChevronDown className="text-muted-foreground size-4 shrink-0 self-center" />
              ) : (
                <ChevronRight className="text-muted-foreground size-4 shrink-0 self-center" />
              )
            ) : (
              // Espaço reservado: sem ele as folhas desalinham das galhas.
              <span className="size-4 shrink-0" aria-hidden />
            )}

            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {no.nome}
            </span>

            <span
              data-slot="metric"
              className={
                no.roas === null
                  ? 'text-muted-foreground shrink-0 text-sm'
                  : no.roas >= 1
                    ? 'text-success shrink-0 text-sm font-semibold'
                    : 'text-destructive-vivid shrink-0 text-sm font-semibold'
              }
            >
              {/* `—` e não `0.00×` quando a venda existiu e a UTM não casou:
                  vermelho ali mandaria cortar a campanha que mais vende. */}
              {no.roas === null ? '—' : `${no.roas.toFixed(2)}×`}
            </span>
          </div>

          <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-4 gap-y-0.5 pl-6 text-xs">
            <span className="tabular">gasto {moeda(no.gasto)}</span>
            <span className="tabular">receita {moeda(no.receita)}</span>
            <span className="tabular">
              {inteiro(no.vendas)} {no.vendas === 1 ? 'venda' : 'vendas'}
            </span>
            {no.cpa !== null && <span className="tabular">CPA {moeda(no.cpa)}</span>}
            {ctr !== null && <span className="tabular">CTR {percentual(ctr, 2)}</span>}

            {no.motivoSemRoas === 'sem-casamento' && (
              <span className="text-warning">
                {no.comprasDaMeta > 0
                  ? `a Meta contou ${inteiro(no.comprasDaMeta)} ${no.comprasDaMeta === 1 ? 'compra' : 'compras'} e nenhuma casou`
                  : `nenhuma venda casou com este ${ROTULO_DO_NIVEL[no.nivel] ?? 'nível'}`}
                {no.nivel > 0 && ' — confira a macro no anúncio'}
              </span>
            )}

            {divergente && (
              <span className="tabular">Meta diz {moeda(no.receitaDaMeta)}</span>
            )}

            {temFilhos && !aberto && (
              <span className="text-muted-foreground/70">
                {inteiro(no.filhos.length)}{' '}
                {no.nivel === 0
                  ? no.filhos.length === 1
                    ? 'conjunto'
                    : 'conjuntos'
                  : no.filhos.length === 1
                    ? 'anúncio'
                    : 'anúncios'}
              </span>
            )}
          </div>
        </button>
      </div>

      {aberto && no.filhos.map((f) => <No key={f.id} no={f} />)}
    </>
  );
}
