import { Sidebar } from '@/components/dash/sidebar';
import { MobileNav } from '@/components/dash/mobile-nav';
import { Topbar } from '@/components/dash/topbar';

export default function DashLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative z-10 flex min-h-dvh">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />

        {/* pb-20 no celular abre espaço para a barra inferior fixa. */}
        <main className="flex-1 px-4 pt-5 pb-24 sm:px-6 sm:pt-6 md:pb-8">
          {children}
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
