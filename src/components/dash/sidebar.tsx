'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { comPeriodo } from '@/lib/painel/periodo';
import { NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/dash/logo';

/** Navegação lateral — só no desktop. No celular quem navega é a MobileNav. */
export function Sidebar() {
  const pathname = usePathname();
  // A escolha de período acompanha a navegação — ver `comPeriodo`.
  const periodo = useSearchParams().get('periodo');

  return (
    <aside className="border-border/60 bg-background/40 hidden w-60 shrink-0 flex-col border-r backdrop-blur-sm md:flex">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={comPeriodo(item.href, periodo)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary-vivid font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
