import { cn } from '@/lib/utils';

/**
 * O retângulo que ocupa o lugar do dado enquanto ele não chegou.
 *
 * Existe para o `loading.tsx` de cada aba ter a MESMA geometria da tela real.
 * Um esqueleto de tamanho diferente é pior que nenhum: a tela salta quando o
 * dado chega, e o olho perde o lugar onde estava lendo.
 *
 * A cor é `--foreground` a 10%, não `--muted`, e a foto é que decidiu: no
 * escuro o `--muted` (13%) fica a um ou dois pontos do cartão de vidro (~9%)
 * e o esqueleto SOME — a tela carregando parecia só uma tela vazia. Sobre a
 * cor do texto o valor se ajusta sozinho nos dois temas: no escuro ela é
 * quase branca e clareia o cartão, no claro é quase preta e o escurece.
 * Um valor, dois temas, sem token novo para auditar.
 *
 * `animate-pulse` respeita `prefers-reduced-motion` por padrão no Tailwind 4.
 */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('bg-foreground/10 animate-pulse rounded-md', className)}
      {...props}
    />
  );
}
