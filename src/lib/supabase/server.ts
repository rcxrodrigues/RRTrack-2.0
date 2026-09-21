import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { envPublico } from '@/lib/env';

/**
 * Cliente para Server Components, Server Actions e Route Handlers.
 *
 * Um cliente NOVO a cada requisição — nunca reaproveitado. A própria
 * documentação do @supabase/ssr é explícita: compartilhar um cliente entre
 * requisições deixa as respostas seguintes sem os cabeçalhos de cache
 * obrigatórios.
 */
export async function criarClienteServidor() {
  const cookieStore = await cookies();
  const { url, anonKey } = envPublico();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components não podem escrever cookies. Isso é esperado:
          // quem renova a sessão é o proxy.ts, que roda antes e grava tanto
          // os cookies quanto os cabeçalhos anti-cache.
        }
      },
    },
  });
}

/**
 * O usuário autenticado, ou `null`.
 *
 * Usa `getClaims()`, que a documentação do @supabase/ssr recomenda sobre
 * `getSession()` e `getUser()`: valida a assinatura do JWT localmente, sem
 * uma ida ao servidor de Auth a cada verificação.
 */
export async function usuarioAtual(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return null;

  const { sub, email } = data.claims;
  if (typeof sub !== 'string') return null;

  return { id: sub, email: typeof email === 'string' ? email : null };
}
