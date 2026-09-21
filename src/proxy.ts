import type { NextRequest } from 'next/server';

import { atualizarSessao } from '@/lib/supabase/proxy';

// No Next 16 o antigo `middleware.ts` chama-se `proxy.ts`, e a função
// exportada é `proxy`. Fica em src/, no mesmo nível de app/.
export async function proxy(request: NextRequest) {
  return atualizarSessao(request);
}

export const config = {
  matcher: [
    /*
     * Tudo, menos:
     * - arquivos estáticos e imagens do Next
     * - os endpoints públicos de captura e o webhook: não têm sessão de
     *   usuário, e passá-los pelo refresh só gastaria tempo em cada hit
     * - /t.js, o snippet servido para as landing pages
     */
    '/((?!_next/static|_next/image|favicon\\.ico|t\\.js|api/identify|api/event|api/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
