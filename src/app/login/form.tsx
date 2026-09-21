'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { enviarLinkDeAcesso, type EstadoLogin } from './actions';

const INICIAL: EstadoLogin = { status: 'inicial' };

function BotaoEnviar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Enviando…' : 'Receber link de acesso'}
    </Button>
  );
}

export function FormularioLogin({ proximo }: { proximo: string }) {
  const [estado, acao] = useActionState(enviarLinkDeAcesso, INICIAL);

  if (estado.status === 'enviado') {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="text-primary-vivid size-8" />
        <p className="text-sm font-medium">Link enviado</p>
        <p className="text-muted-foreground max-w-xs text-sm">
          Se esse e-mail tiver acesso ao painel, o link de entrada chega em
          instantes. Ele vale por uma hora e serve uma vez só.
        </p>
      </div>
    );
  }

  return (
    <form action={acao} className="flex flex-col gap-4">
      <input type="hidden" name="proximo" value={proximo} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="voce@exemplo.com"
          required
          autoFocus
          aria-invalid={estado.status === 'erro'}
          aria-describedby={estado.status === 'erro' ? 'erro-login' : undefined}
        />
      </div>

      {estado.status === 'erro' && estado.mensagem ? (
        <p id="erro-login" role="alert" className="text-destructive-vivid text-sm">
          {estado.mensagem}
        </p>
      ) : null}

      <BotaoEnviar />

      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <Mail className="mt-0.5 size-3.5 shrink-0" />
        Não há cadastro: o acesso é criado manualmente. Sem senha para vazar.
      </p>
    </form>
  );
}
