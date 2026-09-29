'use client';

import { usePathname } from 'next/navigation';

import { NAV_ITEMS } from '@/lib/nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/dash/logo';
import { BotaoAtualizar } from '@/components/dash/botao-atualizar';

function titleFor(pathname: string): string {
  const match = NAV_ITEMS.find((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  );
  return match?.label ?? 'RRTrack';
}

export function Topbar({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="border-border/60 bg-background/70 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur-lg sm:px-6">
      {/* No celular não há sidebar, então a marca vive aqui. */}
      <div className="md:hidden">
        <Logo />
      </div>

      <h1 className="hidden text-base font-semibold tracking-tight md:block">
        {titleFor(pathname)}
      </h1>

      <div className="ml-auto flex items-center gap-1">
        {/*
          Na topbar, e não em cada aba: o painel inteiro é `force-dynamic`, e
          "está atualizado?" é a mesma pergunta em todas elas. Um botão por
          tela seria o mesmo código repetido cinco vezes, e o dia em que uma
          aba nova esquecesse de copiar ninguém notaria.
        */}
        <BotaoAtualizar />
        <ThemeToggle />
        {children}
      </div>
    </header>
  );
}
