import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * O callback do magic link é a ÚNICA rota que grava sessão de dentro de um
 * Route Handler — a resposta dela sai com `Set-Cookie` do token.
 *
 * Duas coisas precisam valer nela, e nenhuma das duas quebra nada quando
 * falha:
 *
 * 1. a resposta leva os cabeçalhos anti-cache do @supabase/ssr. Sem eles um
 *    CDN pode guardar a resposta e servir esta sessão para outra pessoa.
 *    Medido num build de produção: Route Handler que grava cookie responde
 *    SEM `Cache-Control` nenhum — o Next não repõe.
 * 2. o destino do redirect passa por `caminhoInterno`. Sem isso o callback
 *    vira trampolim: um link com `?proximo=https://golpe.com` levaria para
 *    fora do domínio logo depois de entrar.
 *
 * `rotas.test.ts` já prova o `caminhoInterno` sozinho. O que se prova AQUI é
 * que a rota o usa — que é outra afirmação, e a que de fato protege.
 */

const CABECALHOS_DO_SSR = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
} as const;

const CODE_BOM = 'code-que-o-supabase-aceita';

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

vi.mock('@/lib/supabase/server', () => ({
  criarClienteServidorComCabecalhos: () => {
    // Objeto vivo, como no de verdade: quem o enche é o `setAll`, durante a
    // chamada de auth — não na criação do cliente.
    const cabecalhos: Record<string, string> = {};
    const recusa = { error: { code: 'otp_expired', message: 'link vencido' } };

    return Promise.resolve({
      cabecalhos,
      supabase: {
        auth: {
          exchangeCodeForSession: (code: string) => {
            if (code !== CODE_BOM) return Promise.resolve(recusa);
            Object.assign(cabecalhos, CABECALHOS_DO_SSR);
            return Promise.resolve({ error: null });
          },
          verifyOtp: () => Promise.resolve(recusa),
        },
      },
    });
  },
}));

const { GET } = await import('./route');

function pedido(query: string) {
  return new NextRequest(`https://track.transforlar.com/auth/callback${query}`);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /auth/callback', () => {
  it('leva os cabeçalhos anti-cache na resposta que grava a sessão', async () => {
    const resposta = await GET(pedido(`?code=${CODE_BOM}`));

    expect(resposta.status).toBe(307);
    for (const [chave, valor] of Object.entries(CABECALHOS_DO_SSR)) {
      expect(resposta.headers.get(chave)).toBe(valor);
    }
  });

  it('não redireciona para fora do domínio, mesmo pedindo', async () => {
    const resposta = await GET(
      pedido(`?code=${CODE_BOM}&proximo=${encodeURIComponent('https://golpe.com/pegadinha')}`),
    );

    const destino = new URL(resposta.headers.get('location') ?? '');
    expect(destino.host).toBe('track.transforlar.com');
  });

  it('manda para a tela de erro quando o link não vale, sem estourar', async () => {
    const resposta = await GET(pedido('?code=vencido'));

    const destino = new URL(resposta.headers.get('location') ?? '');
    expect(destino.pathname).toBe('/auth/erro');
    // Sessão nenhuma foi gravada, então não há cabeçalho a aplicar — e o
    // aplicador roda mesmo assim, sem precisar decidir nada.
    expect(resposta.headers.get('Cache-Control')).toBeNull();
  });
});
