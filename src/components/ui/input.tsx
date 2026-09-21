import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // h-11 no celular: alvo de toque confortável e, no iOS, text-base
        // evita o zoom automático ao focar o campo.
        'border-input bg-background/50 flex h-11 w-full rounded-md border px-3 py-2 text-base transition-[color,box-shadow] outline-none sm:h-10 sm:text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/25',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
