import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O cookie de sessão sai com os cabeçalhos anti-cache — ou não sai seguro.
 *
 * O @supabase/ssr entrega, no SEGUNDO parâmetro do `setAll`, três
 * cabeçalhos. A doc do próprio pacote (types.d.ts) diz para que servem, com
 * todas as letras: "Responses that set auth cookies must not be cached by
 * CDNs or reverse proxies, otherwise one user's session token can be served
 * to a different user."
 *
 * Uma versão anterior deste arquivo declarava `setAll(cookiesToSet)` — um
 * parâmetro só — e os três se perdiam calados. Ler o código não pega: as
 * duas assinaturas compilam igual e a que descarta não dá erro nenhum. Por
 * isso o teste EXECUTA o `setAll` e olha o que sobrou do lado de fora.
 */

const CABECALHOS_DO_SSR = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
} as const;

type SetAll = (
  cookies: { name: string; value: string; options: object }[],
  headers: Record<string, string>,
) => void;

let setAllCapturado: SetAll | null = null;
let gravados: string[] = [];
/** Liga o modo "Server Component": lá o `set` estoura, e é esperado. */
let setEstoura = false;

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: (name: string) => {
        if (setEstoura) throw new Error('Cookies can only be modified in a Server Action');
        gravados.push(name);
      },
    }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _chave: string,
    opcoes: { cookies: { setAll: SetAll } },
  ) => {
    setAllCapturado = opcoes.cookies.setAll;
    return { auth: {} };
  },
}));

vi.mock('@/lib/env', () => ({
  envPublico: () => ({ url: 'https://exemplo.supabase.co', anonKey: 'chave-publica' }),
}));

const { criarClienteServidorComCabecalhos } = await import('./server');

const COOKIE_DE_SESSAO = [
  { name: 'sb-exemplo-auth-token', value: 'jwt-de-mentira', options: {} },
];

beforeEach(() => {
  setAllCapturado = null;
  gravados = [];
  setEstoura = false;
});

describe('criarClienteServidorComCabecalhos', () => {
  it('entrega os cabeçalhos anti-cache que vieram com o cookie de sessão', async () => {
    const { cabecalhos } = await criarClienteServidorComCabecalhos();

    // Antes de gravar sessão não há o que aplicar — e é por isso que a rota
    // pode chamar o aplicador nas saídas de erro sem precisar decidir nada.
    expect(cabecalhos).toEqual({});

    expect(setAllCapturado).not.toBeNull();
    setAllCapturado?.(COOKIE_DE_SESSAO, { ...CABECALHOS_DO_SSR });

    expect(cabecalhos).toEqual(CABECALHOS_DO_SSR);
    expect(gravados).toContain('sb-exemplo-auth-token');
  });

  it('guarda os cabeçalhos mesmo quando o cookie não pode ser gravado', async () => {
    // Num Server Component o `set` estoura — e é esperado, quem renova a
    // sessão ali é o proxy.ts. O que NÃO pode é a explosão levar os
    // cabeçalhos junto: o `Object.assign` vem antes do `try` justamente
    // por isso, e trocar a ordem não quebraria nada visível.
    setEstoura = true;

    const { cabecalhos } = await criarClienteServidorComCabecalhos();
    expect(setAllCapturado).not.toBeNull();
    setAllCapturado?.(COOKIE_DE_SESSAO, { ...CABECALHOS_DO_SSR });

    expect(cabecalhos).toEqual(CABECALHOS_DO_SSR);
    expect(gravados).toEqual([]);
  });
});
