import Link from 'next/link';

import { PERIODOS, ROTULOS, type Periodo } from '@/lib/painel/periodo';
import { cn } from '@/lib/utils';

/**
 * O filtro de período — uma linha acima de tudo.
 *
 * São `<Link>`, não botões com `onClick`: o período vive na URL, então o
 * estado é compartilhável, sobrevive ao recarregar, e a tela funciona antes
 * do JS carregar (e continua funcionando se ele não carregar). Um seletor de
 * filtro é a última coisa que deveria depender de hidratação.
 */
export function SeletorPeriodo({ atual }: { atual: Periodo }) {
  return (
    <nav
      aria-label="Período"
      className="glass flex w-full gap-1 overflow-x-auto rounded-lg p-1 sm:w-auto"
    >
      {PERIODOS.map((periodo) => {
        const ativo = periodo === atual;
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
  );
}
