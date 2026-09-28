import Link from 'next/link';

import {
  ehFaixa,
  PERIODOS,
  ROTULOS,
  rotuloDaEscolha,
  type Escolha,
} from '@/lib/painel/periodo';
import { cn } from '@/lib/utils';

/**
 * O filtro de período — uma linha acima de tudo.
 *
 * São `<Link>`, não botões com `onClick`: o período vive na URL, então o
 * estado é compartilhável, sobrevive ao recarregar, e a tela funciona antes
 * do JS carregar (e continua funcionando se ele não carregar). Um seletor de
 * filtro é a última coisa que deveria depender de hidratação.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A FAIXA SEGUE A MESMA REGRA, e é por isso que é um `<form method="get">`.│
 * │                                                                          │
 * │ Dois `<input type="date">` num formulário GET viram `?de=…&ate=…`        │
 * │ sozinhos, sem uma linha de JavaScript — o navegador faz. Um seletor de   │
 * │ calendário em React daria mais controle sobre o visual e custaria a      │
 * │ propriedade que os cinco atalhos já têm.                                 │
 * │                                                                          │
 * │ O `type="date"` também resolve o formato: o navegador MOSTRA no formato  │
 * │ de quem olha (dd/mm/aaaa aqui) e MANDA sempre `YYYY-MM-DD`. Um campo de  │
 * │ texto exigiria adivinhar se "03/04" é março ou abril.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function SeletorPeriodo({ atual }: { atual: Escolha }) {
  const faixa = ehFaixa(atual) ? atual : null;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
      <nav
        aria-label="Período"
        className="glass flex w-full gap-1 overflow-x-auto rounded-lg p-1 sm:w-auto"
      >
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
                'flex min-h-9 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none',
                ativo
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
              )}
            >
              {ROTULOS[periodo]}
            </Link>
          );
        })}
      </nav>

      {/*
        GRADE no celular, LINHA no desktop — e foi a foto que decidiu.

        Tudo numa linha só, a 390px, o botão roubava largura dos campos e a
        data saía CORTADA no ano: `09/01/2(`. Um seletor de data que não deixa
        ler a data escolhida é pior que não ter seletor — a pessoa não tem
        como conferir o que pediu. Na grade os dois campos dividem a linha
        inteira e o botão desce, com espaço de sobra para `dd/mm/aaaa`.
      */}
      <form
        method="get"
        aria-label="Período personalizado"
        className={cn(
          'glass grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1 rounded-lg p-1',
          'sm:flex sm:w-auto',
          // Quando a faixa está valendo, ela é que fica acesa — os atalhos
          // ficam apagados acima. Sem isto as duas metades pareceriam ativas.
          faixa && 'ring-primary ring-1',
        )}
      >
        <input
          type="date"
          name="de"
          defaultValue={faixa?.de ?? ''}
          required
          aria-label="Data inicial"
          className="bg-input/40 ring-border min-h-9 w-full min-w-0 rounded-md px-2 text-sm ring-1 sm:w-auto"
        />
        <span className="text-muted-foreground shrink-0 px-1 text-xs">até</span>
        <input
          type="date"
          name="ate"
          defaultValue={faixa?.ate ?? ''}
          required
          aria-label="Data final"
          className="bg-input/40 ring-border min-h-9 w-full min-w-0 rounded-md px-2 text-sm ring-1 sm:w-auto"
        />
        <button
          type="submit"
          className={cn(
            'col-span-3 min-h-9 shrink-0 rounded-md px-3 text-sm font-medium transition-colors sm:col-span-1',
            faixa
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
          )}
        >
          {faixa ? rotuloDaEscolha(faixa) : 'Aplicar'}
        </button>
      </form>
    </div>
  );
}
