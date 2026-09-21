import { NextResponse, type NextRequest } from 'next/server';

import { carregarConfiguracao } from '@/lib/settings';
import { montarSnippet } from '@/lib/snippet';

/**
 * Serve o snippet de captura.
 *
 * Diferente dos endpoints de captura, este NÃO tem allowlist de origem: é um
 * `<script src>`, e tag de script não manda `Origin`. Também não precisa —
 * o arquivo só contém ids de GA4 e de pixel, que qualquer visitante do site
 * enxerga no navegador de qualquer forma. Token nenhum passa por aqui.
 *
 * Quem protege a gravação é o `/api/identify` e o `/api/event`, com CORS por
 * allowlist.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = await carregarConfiguracao();

  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const protocolo = host.startsWith('localhost') ? 'http' : 'https';
  const base = `${protocolo}://${host}`;

  return new NextResponse(montarSnippet(base, config), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Cinco minutos no navegador, com revalidação ao fundo por uma hora:
      // cadastrar um pixel novo no painel chega ao site sem ninguém limpar
      // cache, e ainda assim não é um pedido por pageview.
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
