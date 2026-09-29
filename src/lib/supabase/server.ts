import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { envPublico } from '@/lib/env';

/**
 * Cliente + os cabeçalhos anti-cache que vêm junto com o cookie de sessão.
 *
 * Um cliente NOVO a cada requisição — nunca reaproveitado. A própria
 * documentação do @supabase/ssr é explícita: compartilhar um cliente entre
 * requisições deixa as respostas seguintes sem os cabeçalhos de cache
 * obrigatórios.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ `cabecalhos` COMEÇA VAZIO e só se enche quando a sessão é gravada.      │
 * │                                                                         │
 * │ Quem escreve sessão num Route Handler PRECISA aplicá-lo na resposta,    │
 * │ DEPOIS da chamada de auth — é um objeto vivo, preenchido no `setAll`.   │
 * │ O `cookies()` do Next grava cookie, e só: cabeçalho de resposta ele não │
 * │ alcança, e o Next não repõe nenhum por conta própria (medido: um Route  │
 * │ Handler que grava cookie responde SEM `Cache-Control`).                 │
 * │                                                                         │
 * │ Sem eles, um CDN (a Vercel é um) pode cachear a resposta que carrega o  │
 * │ Set-Cookie de sessão e servir o token de um usuário para outro. É o     │
 * │ mesmo cuidado que o proxy.ts já toma — ver o comentário lá.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export async function criarClienteServidorComCabecalhos() {
  const cookieStore = await cookies();
  const { url, anonKey } = envPublico();
  const cabecalhos: Record<string, string> = {};

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Guardado ANTES de tentar gravar: num Server Component o `set`
        // abaixo estoura, e quem PODE aplicar os cabeçalhos ainda precisa
        // recebê-los.
        Object.assign(cabecalhos, headers);

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

  return { supabase, cabecalhos };
}

/**
 * Cliente para Server Components, Server Actions e Route Handlers que só
 * LEEM a sessão.
 *
 * Route Handler que a ESCREVE usa `criarClienteServidorComCabecalhos` e
 * aplica os cabeçalhos na resposta.
 */
export async function criarClienteServidor() {
  const { supabase } = await criarClienteServidorComCabecalhos();
  return supabase;
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
