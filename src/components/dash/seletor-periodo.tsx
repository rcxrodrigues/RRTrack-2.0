import Link from 'next/link';
import { Check, ChevronDown } from 'lucide-react';

import {
  ehFaixa,
  PERIODOS,
  ROTULOS,
  rotuloDaEscolha,
  type Escolha,
} from '@/lib/painel/periodo';
import { cn } from '@/lib/utils';

/**
 * O filtro de período: UM controle, igual no desktop e no celular.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ERA UMA FILEIRA DE ATALHOS, E NO CELULAR FICAVA CARO.                   │
 * │                                                                          │
 * │ Cinco chips numa linha que rolava na horizontal, mais os dois campos de  │
 * │ data e o botão — três linhas no topo da tela mais importante do painel,  │
 * │ antes de qualquer número, empurrando as métricas para fora da primeira   │
 * │ dobra. E a fileira que rola esconde opção: "Este mês" só aparecia        │
 * │ arrastando, e ninguém arrasta o que não sabe que existe.                 │
 * │                                                                          │
 * │ Agora é um menu: o gatilho diz o que está valendo, a lista abre por      │
 * │ cima, e a faixa personalizada mora no pé dela. Mesma altura nos dois     │
 * │ tamanhos de tela, e nada fica escondido fora do quadro.                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * **`<details>`, não um dropdown em React.** O navegador abre e fecha sozinho,
 * com semântica de botão e estado expandido para o leitor de tela, e sem uma
 * linha de JS. As opções são `<Link>` porque o período vive na URL — o estado
 * é compartilhável, sobrevive ao recarregar e funciona antes da hidratação.
 * Um `<select>` com `onChange` custaria JS para reimplementar o que o
 * navegador já faz, e pararia de funcionar se ele não carregasse.
 *
 * **A faixa fica NA MESMA lista, não atrás de escolher "Personalizado".** Na
 * referência é preciso selecionar a opção para só então ver os campos; aqui
 * eles já estão no pé, a um toque de distância em vez de dois.
 *
 * **`.flutuante`, não `.glass`.** O painel abre POR CIMA do conteúdo, e vidro
 * translúcido deixa o texto de trás aparecer através dos campos de data. É a
 * regra que o seletor de moeda aprendeu primeiro.
 */
export function SeletorPeriodo({
  atual,
  hoje,
}: {
  atual: Escolha;
  /** `YYYY-MM-DD` no fuso do painel — ver `hojeEm`. */
  hoje: string;
}) {
  const faixa = ehFaixa(atual) ? atual : null;

  return (
    <details className="group relative w-full sm:w-64">
      <summary
        // Sem o triângulo do navegador: o marcador padrão estraga o
        // alinhamento e muda de desenho entre navegadores.
        className={cn(
          'glass ring-border flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-sm ring-1 transition-colors',
          'hover:bg-muted/40 group-open:ring-primary',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <span className="flex min-w-0 flex-col text-left">
          <span className="text-muted-foreground text-[0.7rem] leading-none">
            Período
          </span>
          <span className="truncate font-medium">{rotuloDaEscolha(atual)}</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="flutuante absolute inset-x-0 z-30 mt-1 rounded-lg p-1">
        {PERIODOS.map((periodo) => {
          const ativo = !faixa && periodo === atual;
          return (
            <Link
              key={periodo}
              // Query relativa: preserva o caminho, então o mesmo componente
              // serve a visão geral, o faturamento e o geo.
              href={`?periodo=${periodo}`}
              aria-current={ativo ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center justify-between gap-2 rounded-md px-3 text-sm transition-colors',
                ativo
                  ? 'bg-primary/10 text-primary-vivid font-medium'
                  : 'hover:bg-muted/60',
              )}
            >
              {ROTULOS[periodo]}
              {/* A marca fica no item escolhido — num menu aberto, cor de
                  fundo sozinha se confunde com o item sob o dedo. */}
              {ativo && <Check className="size-4 shrink-0" />}
            </Link>
          );
        })}

        <form
          method="get"
          aria-label="Período personalizado"
          className="border-border/60 mt-1 flex flex-col gap-2 border-t px-3 pt-3 pb-2"
        >
          <span
            className={cn(
              'text-xs',
              faixa ? 'text-primary-vivid font-medium' : 'text-muted-foreground',
            )}
          >
            Personalizado
          </span>

          {/*
            Um campo por linha, com rótulo em cima. A largura de um
            `<input type="date">` não se supõe — quem escolhe o formato é o
            NAVEGADOR, e o Safari em pt-BR escreve `29 de set. de 2026`,
            mais que o dobro do `09/28/2026` do Chromium. Lado a lado, o
            segundo saía cortado pela borda no iPhone.
          */}
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[0.7rem]">De</span>
            <input
              type="date"
              name="de"
              defaultValue={faixa?.de ?? hoje}
              required
              className="bg-input/40 ring-border min-h-9 w-full min-w-0 rounded-md px-2 text-sm ring-1"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[0.7rem]">Até</span>
            <input
              type="date"
              name="ate"
              defaultValue={faixa?.ate ?? hoje}
              required
              className="bg-input/40 ring-border min-h-9 w-full min-w-0 rounded-md px-2 text-sm ring-1"
            />
          </label>

          <button
            type="submit"
            className="bg-primary text-primary-foreground min-h-9 rounded-md px-3 text-sm font-medium"
          >
            Aplicar
          </button>
        </form>
      </div>
    </details>
  );
}
