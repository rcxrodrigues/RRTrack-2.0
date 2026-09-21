'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Um valor para copiar — URL do webhook, tag do snippet, link de checkout.
 *
 * `multilinha` troca o `truncate` de uma linha por um bloco com rolagem: a
 * tag do script não cabe numa linha só e cortá-la esconde justamente o que a
 * pessoa precisa conferir.
 */
export function CampoCopiavel({
  valor,
  rotulo,
  multilinha = false,
}: {
  valor: string;
  rotulo: string;
  multilinha?: boolean;
}) {
  const [copiado, setCopiado] = React.useState(false);

  // onClick espera retorno void: a promessa é resolvida aqui dentro e não
  // devolvida para o React.
  function copiar(): void {
    void (async () => {
      try {
        await navigator.clipboard.writeText(valor);
        setCopiado(true);
        setTimeout(() => { setCopiado(false); }, 2000);
      } catch {
        toast.error('Não consegui copiar', {
          description: 'Selecione e copie à mão.',
        });
      }
    })();
  }

  return (
    <div className={multilinha ? 'flex flex-col gap-2' : 'flex items-center gap-2'}>
      <code
        className={
          multilinha
            ? 'bg-muted/60 ring-border overflow-x-auto rounded-md px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap ring-1'
            : 'bg-muted/60 ring-border min-w-0 flex-1 truncate rounded-md px-3 py-2 font-mono text-xs ring-1'
        }
      >
        {valor}
      </code>
      <Button
        type="button"
        variant="outline"
        size={multilinha ? 'sm' : 'icon'}
        onClick={copiar}
        aria-label={`Copiar ${rotulo}`}
        className={multilinha ? 'self-end' : undefined}
      >
        {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
        {multilinha && (copiado ? 'Copiado' : 'Copiar')}
      </Button>
    </div>
  );
}
