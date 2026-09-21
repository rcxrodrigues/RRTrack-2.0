'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MOBILE_NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Barra inferior do celular. Fica sobre o conteúdo, respeita a área segura do
 * iPhone e cada alvo tem no mínimo 44px de altura.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="border-border/60 bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-lg md:hidden">
      <ul
        className="flex items-stretch justify-around"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {MOBILE_NAV_ITEMS.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] transition-colors',
                  active
                    ? 'text-primary-vivid font-medium'
                    : 'text-muted-foreground',
                )}
              >
                <item.icon className="size-5 shrink-0" />
                {item.shortLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
