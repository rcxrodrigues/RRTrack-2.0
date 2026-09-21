'use client';

import { usePathname } from 'next/navigation';

import { NAV_ITEMS } from '@/lib/nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/dash/logo';

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
        <ThemeToggle />
        {children}
      </div>
    </header>
  );
}
