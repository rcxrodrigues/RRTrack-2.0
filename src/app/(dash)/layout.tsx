import { redirect } from 'next/navigation';

import { usuarioAtual } from '@/lib/supabase/server';
import { Sidebar } from '@/components/dash/sidebar';
import { MobileNav } from '@/components/dash/mobile-nav';
import { Topbar } from '@/components/dash/topbar';
import { MenuUsuario } from '@/components/dash/menu-usuario';
import { Toaster } from '@/components/ui/toaster';

export default async function DashLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // A verificação que vale. O proxy.ts faz uma checagem otimista pelo cookie
  // para evitar a viagem até aqui, mas quem realmente autoriza é isto:
  // valida a assinatura do JWT antes de renderizar qualquer dado.
  const usuario = await usuarioAtual();
  if (!usuario) redirect('/login');

  return (
    <div className="relative z-10 flex min-h-dvh">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar>
          <MenuUsuario email={usuario.email} />
        </Topbar>

        {/* pb-24 no celular abre espaço para a barra inferior fixa. */}
        <main className="flex-1 px-4 pt-5 pb-24 sm:px-6 sm:pt-6 md:pb-8">
          {children}
        </main>
      </div>

      <MobileNav />
      <Toaster />
    </div>
  );
}
