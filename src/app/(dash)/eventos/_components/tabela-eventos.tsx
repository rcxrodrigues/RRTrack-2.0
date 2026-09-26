'use client';

import * as React from 'react';

import { Quando } from '@/components/dash/quando';
import { corDoEvento } from '@/lib/painel/cores-evento';
import type { LinhaEvento, Visitante } from '@/lib/painel/eventos';

import { carregarVisitanteDoEvento } from '../actions';
import { PainelVisitante } from './painel-visitante';

/**
 * A lista de eventos capturados.
 *
 * Uma linha por evento. Clicar abre a gaveta do VISITANTE, não o payload
 * daquele evento: a pergunta que se faz olhando esta tela quase nunca é "o
 * que saiu neste disparo?" e quase sempre "quem é essa pessoa e por onde ela
 * andou?". O payload continua a um clique, dentro do histórico.
 *
 * Sem `<table>`: no celular a tabela vira barra de rolagem horizontal, e a
 * regra do projeto é cartão empilhado abaixo de `sm`.
 */
/**
 * O que a tela diz quando não foi a UTM do próprio evento que respondeu.
 *
 * O nível `evento` não ganha qualificador: é o caso preciso, e escrever
 * "(deste evento)" em quase toda linha só gastaria espaço.
 */
const QUALIFICADOR: Record<string, string> = {
  visitante: '(da 1ª visita)',
  referrer: '(referrer)',
  direto: '',
};

export function TabelaEventos({ linhas }: { linhas: LinhaEvento[] }) {
  const [aberto, setAberto] = React.useState<string | null>(null);
  const [visitante, setVisitante] = React.useState<Visitante | null>(null);
  const [carregando, iniciar] = React.useTransition();

  function abrir(linha: LinhaEvento) {
    if (!linha.trckUserId) {
      setAberto(linha.id);
      setVisitante(null);
      return;
    }
    setAberto(linha.id);
    setVisitante(null);
    iniciar(async () => {
      setVisitante(await carregarVisitanteDoEvento(linha.trckUserId ?? ''));
    });
  }

  const fechar = React.useCallback(() => {
    setAberto(null);
    setVisitante(null);
  }, []);

  if (linhas.length === 0) {
    return (
      <p className="text-muted-foreground border-border/60 border-t px-4 py-8 text-center text-sm sm:px-5">
        Nenhum evento neste período com estes filtros.
      </p>
    );
  }

  return (
    <>
      <div className="border-border/60 border-t">
        {linhas.map((linha) => (
          <LinhaDoEvento
            key={linha.id}
            linha={linha}
            ativa={aberto === linha.id}
            aoAbrir={() => { abrir(linha); }}
          />
        ))}
      </div>

      {aberto !== null && (
        <PainelVisitante
          visitante={visitante}
          carregando={carregando}
          aoFechar={fechar}
        />
      )}
    </>
  );
}

function LinhaDoEvento({
  linha,
  ativa,
  aoAbrir,
}: {
  linha: LinhaEvento;
  ativa: boolean;
  aoAbrir: () => void;
}) {
  const lugar = [linha.cidade, linha.regiao, linha.pais].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-expanded={ativa}
      className={
        (ativa ? 'bg-muted/40 ' : '') +
        'hover:bg-muted/40 border-border/60 flex min-h-11 w-full flex-col gap-1 border-b px-4 py-2.5 text-left transition-colors last:border-0 sm:px-5'
      }
    >
      <div className="flex w-full items-center gap-2.5">
        {/* A cor vem de `cores-evento.ts` — a mesma da visão geral. Um ponto,
            não um badge colorido: badge de cor forte em cada linha de uma
            lista longa vira parede de cor e nada se destaca. */}
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: corDoEvento(linha.nome) }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {linha.nome}
        </span>
        <span className="text-muted-foreground tabular shrink-0 font-mono text-xs">
          <Quando iso={linha.criadoEm} />
        </span>
      </div>

      <div className="text-muted-foreground flex w-full flex-wrap items-baseline gap-x-4 gap-y-0.5 pl-5 text-xs">
        {/*
          A origem em cascata — ver `origem.ts`.

          Antes aqui só cabia a UTM DO EVENTO, e como ela é lida da URL de
          cada evento, só o PageView de entrada costuma tê-la: o AddToCart
          acontece em `/products/x`, sem query string. A MAIORIA das linhas
          dizia "sem campanha na UTM", que lia como falha de marcação
          quando era navegação normal.

          O qualificador entre parênteses não é detalhe: "esta linha
          carregava a campanha" e "esta é de alguém que um dia chegou pela
          campanha" são afirmações diferentes, e a segunda é mais fraca.
          Iguais na tela, prometeriam uma precisão que o dado não tem.
        */}
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={
              linha.origem.nivel === 'direto'
                ? 'text-muted-foreground/60 truncate'
                : 'truncate'
            }
          >
            {linha.origem.rotulo}
          </span>
          {linha.origem.nivel !== 'evento' && (
            <span className="text-muted-foreground/60 shrink-0">
              {QUALIFICADOR[linha.origem.nivel]}
            </span>
          )}
        </span>
        {lugar && <span className="shrink-0">{lugar}</span>}
        {linha.trckUserId && (
          <span className="shrink-0 font-mono">{linha.trckUserId.slice(0, 8)}…</span>
        )}
      </div>
    </button>
  );
}
