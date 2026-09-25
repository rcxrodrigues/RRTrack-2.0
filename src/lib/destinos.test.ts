import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { objeto, texto } from '@/lib/json';

/**
 * O fan-out, testado de verdade: com fetch e banco de mentira, mas com a
 * lógica real de `dispararEvento`.
 *
 * O que está em jogo é a promessa de que um destino quebrado não leva os
 * outros junto. Isso não dá para verificar lendo o código — `Promise.all` e
 * `Promise.allSettled` se parecem demais.
 */

const carregarConfiguracao = vi.fn();
const rpc = vi.fn();
const update = vi.fn();
const eq = vi.fn();

vi.mock('@/lib/settings', () => ({
  carregarConfiguracao: () => carregarConfiguracao(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClienteAdmin: () => ({
    rpc: (nome: string, args: unknown) => rpc(nome, args),
    from: () => ({ update: (v: unknown) => { update(v); return { eq }; } }),
  }),
}));

const { dispararEvento, invalidarTokens } = await import('./destinos');

const EVENTO = {
  event_name: 'Purchase',
  event_time: 1_758_400_000,
  event_id: 'evt-fanout-001',
  action_source: 'website' as const,
  user_data: { em: ['a'.repeat(64)] },
};

function configCom(pixels: { id: string; pixelId: string }[], testEventCode: string | null = null) {
  return {
    settings: {
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      testEventCode,
      cookieDomain: null,
      origensPermitidas: [],
      dominiosCheckout: [],
      statusPorAlias: {},
    },
    ga4: [{ id: 'ga-1', measurementId: 'G-ABC' }],
    pixels,
  };
}

/*
 * Leitores dos mocks usando os type guards de verdade do projeto. Sem `as`:
 * o lint recusa asserção, e com razão — um teste que afirma o tipo em vez de
 * conferir pode passar sobre um valor que nunca existiu.
 */

/** A resposta gravada no log para um pixel. */
function respostaDe(pixelId: string): { ok: boolean; erro: string | undefined } {
  const gravado: unknown = update.mock.calls[0]?.[0];
  const resposta = objeto(objeto(gravado, 'response_meta'), pixelId);
  if (!resposta) throw new Error(`nada gravado para o pixel ${pixelId}`);
  return { ok: resposta.ok === true, erro: texto(resposta, 'erro') };
}

/** O corpo enviado na chamada `n` ao fetch. */
function corpoEnviado(fetchMock: ReturnType<typeof vi.fn>, n = 0): string {
  const opcoes: unknown = fetchMock.mock.calls[n]?.[1];
  return texto(opcoes, 'body') ?? '';
}

/** A URL da chamada `n` ao fetch. */
function urlChamada(fetchMock: ReturnType<typeof vi.fn>, n = 0): string {
  const url: unknown = fetchMock.mock.calls[n]?.[0];
  return typeof url === 'string' ? url : '';
}

/** Resposta de sucesso da Graph API. */
function okMeta() {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ events_received: 1, fbtrace_id: 'trace-1' }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidarTokens();
  eq.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: 'token-secreto', error: null });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('dispararEvento', () => {
  it('manda para TODOS os pixels ativos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okMeta());
    vi.stubGlobal('fetch', fetchMock);
    carregarConfiguracao.mockResolvedValue(
      configCom([
        { id: 'c1', pixelId: '111111111111111' },
        { id: 'c2', pixelId: '222222222222222' },
      ]),
    );

    await dispararEvento(EVENTO);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((_, i) => urlChamada(fetchMock, i));
    expect(urls.some((u) => u.includes('111111111111111/events'))).toBe(true);
    expect(urls.some((u) => u.includes('222222222222222/events'))).toBe(true);
  });

  /* A promessa central: `allSettled`, não `all`. */
  it('um pixel quebrado NÃO impede o outro de receber', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      url.includes('111111111111111')
        ? Promise.reject(new Error('conexão caiu'))
        : Promise.resolve(okMeta()),
    );
    vi.stubGlobal('fetch', fetchMock);
    carregarConfiguracao.mockResolvedValue(
      configCom([
        { id: 'c1', pixelId: '111111111111111' },
        { id: 'c2', pixelId: '222222222222222' },
      ]),
    );

    await dispararEvento(EVENTO);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(respostaDe('111111111111111').ok).toBe(false);
    expect(respostaDe('222222222222222').ok).toBe(true);
  });

  it('pixel sem token é registrado, não silenciado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okMeta()));
    rpc.mockResolvedValue({ data: null, error: null });
    carregarConfiguracao.mockResolvedValue(configCom([{ id: 'c1', pixelId: '111111111111111' }]));

    await dispararEvento(EVENTO);

    expect(respostaDe('111111111111111').ok).toBe(false);
    expect(respostaDe('111111111111111').erro).toContain('sem token');
  });

  /*
   * A Meta responde 200 e descarta. Contar isso como sucesso esconderia no
   * log justamente o caso que precisa aparecer.
   */
  it('200 com events_received = 0 conta como FALHA', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ events_received: 0 }),
      }),
    );
    carregarConfiguracao.mockResolvedValue(configCom([{ id: 'c1', pixelId: '111111111111111' }]));

    await dispararEvento(EVENTO);

    expect(respostaDe('111111111111111').ok).toBe(false);
  });

  it('o token vai no CORPO, nunca na URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okMeta());
    vi.stubGlobal('fetch', fetchMock);
    carregarConfiguracao.mockResolvedValue(configCom([{ id: 'c1', pixelId: '111111111111111' }]));

    await dispararEvento(EVENTO);

    expect(urlChamada(fetchMock)).not.toContain('token-secreto');
    expect(corpoEnviado(fetchMock)).toContain('token-secreto');
  });

  /* O log é auditoria; um token ali seria um segredo vazado em repouso. */
  it('o payload GRAVADO não carrega o token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okMeta()));
    carregarConfiguracao.mockResolvedValue(configCom([{ id: 'c1', pixelId: '111111111111111' }]));

    await dispararEvento(EVENTO);

    expect(JSON.stringify(update.mock.calls[0]?.[0])).not.toContain('token-secreto');
  });

  it('o mesmo token não é lido do cofre a cada evento', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okMeta()));
    carregarConfiguracao.mockResolvedValue(configCom([{ id: 'c1', pixelId: '111111111111111' }]));

    await dispararEvento(EVENTO);
    await dispararEvento({ ...EVENTO, event_id: 'evt-2' });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('sem pixel cadastrado, não chama nada nem grava nada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    carregarConfiguracao.mockResolvedValue(configCom([]));

    await dispararEvento(EVENTO);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  /* Roda em `after()`: quem chamou já respondeu e não tem como tratar erro. */
  it('não lança quando o banco falha ao gravar a resposta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okMeta()));
    eq.mockResolvedValue({ error: { message: 'banco fora' } });
    carregarConfiguracao.mockResolvedValue(configCom([{ id: 'c1', pixelId: '111111111111111' }]));

    await expect(dispararEvento(EVENTO)).resolves.toBeUndefined();
  });

  it('leva o test_event_code da configuração', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okMeta());
    vi.stubGlobal('fetch', fetchMock);
    carregarConfiguracao.mockResolvedValue(
      configCom([{ id: 'c1', pixelId: '111111111111111' }], 'TEST999'),
    );

    await dispararEvento(EVENTO);

    const corpo: unknown = JSON.parse(corpoEnviado(fetchMock));
    expect(texto(corpo, 'test_event_code')).toBe('TEST999');
  });
});
