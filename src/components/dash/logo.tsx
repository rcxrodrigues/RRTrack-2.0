import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * A marca.
 *
 * O ícone é usado como imagem, mas o "RRTrack" é TEXTO, não a arte
 * completa: o lettering do arquivo é branco e sumiria no tema claro.
 * Em texto, ele acompanha o tema — e ainda é selecionável e lido por
 * leitor de tela.
 *
 * O ícone em si tem partes brancas, então vive sobre um selo escuro que
 * vale nos dois temas — é também como ele aparece no material da marca.
 */
export function Logo({
  tamanho = 'normal',
  className,
}: {
  tamanho?: 'normal' | 'grande';
  className?: string;
}) {
  const grande = tamanho === 'grande';

  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'ring-primary/30 flex shrink-0 items-center justify-center rounded-lg bg-[hsl(225_50%_7%)] ring-1',
          grande ? 'size-11 p-1.5' : 'size-8 p-1',
        )}
      >
        <Image
          src="/marca/rr-icone.webp"
          alt=""
          width={256}
          height={256}
          className="size-full object-contain"
          priority
        />
      </span>

      <span
        className={cn(
          'font-semibold tracking-tight',
          grande ? 'text-lg' : 'text-sm',
        )}
      >
        RRTrack
        <span
          className={cn(
            'text-muted-foreground ml-1 font-mono font-normal',
            grande ? 'text-xs' : 'text-[10px]',
          )}
        >
          2.0
        </span>
      </span>
    </span>
  );
}
