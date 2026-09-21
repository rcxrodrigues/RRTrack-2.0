import 'server-only';

import { criarClienteAdmin } from '@/lib/supabase/admin';

/**
 * As configurações do painel, com cache curto em memória.
 *
 * Os endpoints de captura rodam a cada pageview do site. Sem cache, cada
 * visita viraria uma consulta ao banco só para descobrir a allowlist de CORS
 * — e a allowlist muda uma vez por mês, não a cada segundo.
 *
 * O cache vive na instância serverless. Depois de mudar algo no painel, a
 * propagação leva até o TTL abaixo.
 */

export type Settings = {
  currency: string;
  testEventCode: string | null;
  cookieDomain: string | null;
  origensPermitidas: string[];
  /** Domínios do checkout — o snippet marca os links que apontam para eles. */
  dominiosCheckout: string[];
};

export type DestinoGa4 = { id: string; measurementId: string };
export type DestinoPixel = { id: string; pixelId: string };

export type Configuracao = {
  settings: Settings;
  ga4: DestinoGa4[];
  pixels: DestinoPixel[];
};

const TTL_MS = 60_000;

/**
 * TTL curto para quando a busca FALHA.
 *
 * Sem ele o cache fica vazio e cada pageview do site tenta o banco de novo:
 * numa queda do Supabase, a captura inteira passa a esperar o timeout da
 * conexão em toda requisição. Cinco segundos seguram a estampida e ainda
 * recuperam rápido quando o banco volta.
 */
const TTL_FALHA_MS = 5_000;

let cache: { valor: Configuracao; expiraEm: number } | null = null;

const PADRAO: Configuracao = {
  settings: {
    currency: 'BRL',
    testEventCode: null,
    cookieDomain: null,
    origensPermitidas: [],
    dominiosCheckout: [],
  },
  ga4: [],
  pixels: [],
};

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** Coluna text[] do Postgres, lida sem confiar no formato. */
function listaDeTexto(valor: unknown): string[] {
  return Array.isArray(valor)
    ? valor.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
}

async function buscar(): Promise<Configuracao> {
  const supabase = criarClienteAdmin();

  const [settings, ga4, pixels] = await Promise.all([
    supabase
      .from('settings')
      .select('currency, test_event_code, cookie_domain, allowed_origins, checkout_domains')
      .eq('id', true)
      .maybeSingle(),
    // Só os destinos ATIVOS: desativar uma conta no painel precisa parar o
    // envio, não só escondê-la da lista.
    supabase
      .from('ga4_accounts')
      .select('id, measurement_id')
      .eq('is_active', true),
    supabase.from('meta_pixels').select('id, pixel_id').eq('is_active', true),
  ]);

  const linha = settings.data;

  return {
    settings: {
      currency: texto(linha?.currency) ?? 'BRL',
      testEventCode: texto(linha?.test_event_code),
      cookieDomain: texto(linha?.cookie_domain),
      origensPermitidas: listaDeTexto(linha?.allowed_origins),
      dominiosCheckout: listaDeTexto(linha?.checkout_domains),
    },
    ga4: (ga4.data ?? []).flatMap((l) => {
      const id = texto(l.id);
      const measurementId = texto(l.measurement_id);
      return id && measurementId ? [{ id, measurementId }] : [];
    }),
    pixels: (pixels.data ?? []).flatMap((l) => {
      const id = texto(l.id);
      const pixelId = texto(l.pixel_id);
      return id && pixelId ? [{ id, pixelId }] : [];
    }),
  };
}

export async function carregarConfiguracao(): Promise<Configuracao> {
  if (cache && cache.expiraEm > Date.now()) return cache.valor;

  try {
    const valor = await buscar();
    cache = { valor, expiraEm: Date.now() + TTL_MS };
    return valor;
  } catch (erro) {
    console.error(
      '[settings] falha ao carregar:',
      erro instanceof Error ? erro.message : erro,
    );
    // Servir o cache vencido é melhor que derrubar a captura: um pico no
    // banco não deveria fazer o site perder eventos.
    const valor = cache?.valor ?? PADRAO;
    cache = { valor, expiraEm: Date.now() + TTL_FALHA_MS };
    return valor;
  }
}

/** Esvazia o cache — chamado depois de salvar no painel. */
export function invalidarConfiguracao(): void {
  cache = null;
}
