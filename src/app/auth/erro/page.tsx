import Link from 'next/link';
import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/dash/logo';

export const metadata: Metadata = { title: 'Link inválido' };

/** O que o Supabase manda em `error_code`, traduzido para o que fazer. */
const MOTIVOS: Record<string, { titulo: string; texto: string }> = {
  otp_expired: {
    titulo: 'Esse link não vale mais',
    texto:
      'Links de acesso servem uma única vez e expiram em uma hora. Também vale ' +
      'saber: alguns provedores de e-mail abrem os links antes de você, para ' +
      'checar segurança — e isso gasta o link. Se acontecer sempre, peça o ' +
      'link e clique nele o quanto antes.',
  },
  access_denied: {
    titulo: 'O acesso foi recusado',
    texto:
      'O link não foi aceito. Normalmente é porque ele já tinha sido usado, ' +
      'ou porque um link mais novo foi pedido depois dele.',
  },
  invalido: {
    titulo: 'Esse link não vale mais',
    texto:
      'Links de acesso expiram em uma hora e funcionam uma única vez. Se você ' +
      'já usou este, ou pediu outro depois, peça um novo.',
  },
};

export default async function ErroAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const explicacao =
    (typeof motivo === 'string' ? MOTIVOS[motivo] : undefined) ?? MOTIVOS.invalido!;

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex justify-center">
          <Logo />
        </div>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="text-warning size-8" />

            <div className="flex flex-col gap-1">
              <h1 className="text-base font-semibold tracking-tight">
                {explicacao.titulo}
              </h1>
              <p className="text-muted-foreground text-sm">{explicacao.texto}</p>
            </div>

            <Button asChild className="w-full">
              <Link href="/login">Pedir um novo link</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
