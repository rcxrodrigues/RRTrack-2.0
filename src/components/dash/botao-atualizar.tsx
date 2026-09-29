'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * Atualiza os dados da aba sem recarregar a página.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `router.refresh()`, NÃO `location.reload()`.                            │
 * │                                                                          │
 * │ O reload joga fora o bundle, as fontes e o CSS e busca tudo de novo —    │
 * │ e ainda perde o que está aberto na tela: a gaveta do visitante fecha, a  │
 * │ árvore de geo volta ao estado fechado, o scroll vai para o topo. Quem    │
 * │ está conferindo um visitante e clica em atualizar perde justamente o     │
 * │ lugar onde estava olhando.                                               │
 * │                                                                          │
 * │ O `refresh` do Next refaz só os Server Components: as consultas rodam    │
 * │ de novo, os números trocam, e o estado do cliente fica de pé.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Toda aba do painel é `force-dynamic`, então não há cache a driblar — o
 * refresh sempre traz dado novo.
 *
 * O ícone gira enquanto a transição está pendente. Sem isso, num painel que
 * responde rápido o clique não produz nada visível e a pessoa clica de novo,
 * achando que não funcionou.
 */
export function BotaoAtualizar() {
  const router = useRouter();
  const [rodando, iniciar] = React.useTransition();

  return (
    <button
      type="button"
      onClick={() => {
        iniciar(() => {
          router.refresh();
        });
      }}
      disabled={rodando}
      aria-label="Atualizar os dados"
      title="Atualizar os dados"
      className={cn(
        'text-muted-foreground hover:text-foreground hover:bg-muted/60',
        'flex size-9 items-center justify-center rounded-md transition-colors',
        'disabled:cursor-default',
      )}
    >
      <RefreshCw className={cn('size-4', rodando && 'animate-spin')} />
    </button>
  );
}
