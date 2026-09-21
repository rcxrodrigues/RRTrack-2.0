import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { caminhoInterno } from '@/lib/rotas';
import { criarClienteServidor } from '@/lib/supabase/server';

/** Tipos de OTP por e-mail que aceitamos trocar por sessão. */
const TIPOS_OTP: readonly EmailOtpType[] = ['magiclink', 'email', 'recovery', 'invite'];

function ehTipoOtp(valor: string | null): valor is EmailOtpType {
  return valor !== null && (TIPOS_OTP as readonly string[]).includes(valor);
}

/**
 * Fecha o fluxo do magic link.
 *
 * Aceita as duas formas que o Supabase pode usar, dependendo do template de
 * e-mail do projeto: `code` (PKCE) e `token_hash` + `type` (verifyOtp).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Atrás da CDN da Vercel, nextUrl.origin pode não ser o host público.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocolo = request.headers.get('x-forwarded-proto') ?? 'https';
  const origem = host ? `${protocolo}://${host}` : request.nextUrl.origin;

  // O destino veio no cookie que a tela de login gravou. A query string
  // continua aceita como reserva, para links antigos que ainda estejam por aí.
  const cookieStore = await cookies();
  const proximo = caminhoInterno(
    cookieStore.get('trck_proximo')?.value ?? searchParams.get('proximo'),
  );
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const tipo = searchParams.get('type');

  const supabase = await criarClienteServidor();

  /** Entrou: leva ao destino e descarta o cookie, que já cumpriu o papel. */
  function entrar() {
    const resposta = NextResponse.redirect(`${origem}${proximo}`);
    resposta.cookies.delete('trck_proximo');
    return resposta;
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return entrar();
    console.error(`[auth] troca de code falhou (${error.code ?? '?'}): ${error.message}`);
  } else if (tokenHash && ehTipoOtp(tipo)) {
    const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
    if (!error) return entrar();
    console.error(`[auth] verifyOtp falhou (${error.code ?? '?'}): ${error.message}`);
  } else {
    console.error('[auth] callback sem code nem token_hash');
  }

  // O Supabase também pode mandar o erro na própria URL, quando recusa o
  // link antes de chegar aqui. Repassamos o motivo para a tela explicar.
  const motivo = searchParams.get('error_code') ?? 'invalido';
  return NextResponse.redirect(`${origem}/auth/erro?motivo=${encodeURIComponent(motivo)}`);
}
