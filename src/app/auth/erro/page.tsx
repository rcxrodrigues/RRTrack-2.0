import Link from 'next/link';
import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/dash/logo';

export const metadata: Metadata = { title: 'Link inválido' };

export default function ErroAuthPage() {
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
                Esse link não vale mais
              </h1>
              <p className="text-muted-foreground text-sm">
                Links de acesso expiram em uma hora e funcionam uma única vez.
                Se você já usou este, ou pediu outro depois, peça um novo.
              </p>
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
