import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { envPublico, envServiceRole } from '@/lib/env';

/**
 * Cliente com `service_role`: IGNORA RLS por completo.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ Só em Route Handlers e Server Actions. O `import 'server-only'` acima │
 * │ transforma qualquer importação a partir de código de cliente em erro  │
 * │ de build — a barreira é o compilador, não a boa memória de quem lê.   │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Não usa @supabase/ssr porque aqui não existe sessão de usuário: é acesso de
 * serviço, sem cookie e sem refresh.
 */
export function criarClienteAdmin(): SupabaseClient {
  const { url } = envPublico();

  return createClient(url, envServiceRole(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
