import type { Metadata } from 'next';

import { caminhoInterno } from '@/lib/rotas';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/dash/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { FormularioLogin } from './form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({
  searchParams,
}: {
  // No Next 16 searchParams é uma Promise.
  searchParams: Promise<{ proximo?: string }>;
}) {
  const { proximo } = await searchParams;
  const destino = caminhoInterno(proximo);

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex justify-center">
          <Logo tamanho="grande" />
        </div>

        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-base font-semibold tracking-tight">
                Entrar no painel
              </h1>
              <p className="text-muted-foreground text-sm">
                Você recebe um link por e-mail. Sem senha.
              </p>
            </div>

            <FormularioLogin proximo={destino} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
