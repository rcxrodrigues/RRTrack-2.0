import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { envPublico } from '@/lib/env';

/** Rotas que qualquer um alcança sem sessão. */
const ROTAS_PUBLICAS = ['/login', '/auth'] as const;

function ehRotaPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`),
  );
}

/**
 * Renova a sessão do Supabase e faz a checagem otimista de acesso.
 *
 * "Otimista" é o termo da documentação do Next: aqui só olhamos o cookie, sem
 * ir ao banco, porque o proxy roda em toda navegação — inclusive nas que o
 * Next prefetcha. A verificação que vale é a do layout do painel.
 */
export async function atualizarSessao(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = envPublico();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // ┌─────────────────────────────────────────────────────────────────┐
        // │ NÃO REMOVA. Estes são os cabeçalhos anti-cache que o            │
        // │ @supabase/ssr entrega junto com os cookies de sessão.           │
        // │                                                                 │
        // │ Sem eles, uma resposta com Set-Cookie de sessão pode ser        │
        // │ cacheada pelo CDN (a Vercel é um) — e o token de um usuário     │
        // │ acaba servido para outro.                                       │
        // │                                                                 │
        // │ Repare que `setAll` recebe DOIS parâmetros nesta versão do      │
        // │ pacote. Exemplos antigos usam só o primeiro.                    │
        // └─────────────────────────────────────────────────────────────────┘
        for (const [chave, valor] of Object.entries(headers)) {
          response.headers.set(chave, valor);
        }
      },
    },
  });

  // Cedo, antes de montar a resposta: se o refresh terminar depois que a
  // resposta já foi fechada, a sessão renovada se perde e a próxima
  // requisição precisa renovar de novo.
  const { data } = await supabase.auth.getClaims();
  const autenticado = typeof data?.claims?.sub === 'string';

  const { pathname } = request.nextUrl;

  if (!autenticado && !ehRotaPublica(pathname)) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/login';
    // Guarda para onde ele queria ir, e o manda de volta após entrar.
    destino.searchParams.set('proximo', pathname);
    return NextResponse.redirect(destino);
  }

  if (autenticado && pathname === '/login') {
    const destino = request.nextUrl.clone();
    destino.pathname = '/';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  return response;
}
