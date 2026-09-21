import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lista, numero, objeto, texto } from '@/lib/json';

/**
 * As travas do disparo da compra. Cada uma existe porque quebrá-la conta
 * conversão errado — e conversão errada ensina o otimizador da Meta a
 * gastar no lugar errado.
 */

const carregarConfiguracao = vi.fn();
const enviarParaTodosOsPixels = vi.fn();
const segredoDoGa4 = vi.fn();
const maybeSingle = vi.fn();
const update = vi.fn();

vi.mock('@/lib/settings', () => ({ carregarConfiguracao: () => carregarConfiguracao() }));
vi.mock('@/lib/destinos', () => ({
  enviarParaTodosOsPixels: (p: unknown) => enviarParaTodosOsPixels(p),
  segredoDoGa4: (id: string) => segredoDoGa4(id),
}));
vi.mock('@/lib/supabase/admin', () => ({
  criarClienteAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ returns: () => ({ maybeSingle }) }),
      }),
      update: (v: unknown) => {
        update(v);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  }),
}));

const { dispararCompra, eventIdDaCompra } = await import('./compras');

const APROVADA = {
  transaction_id: 'yampi:1000001',
  status: 'aprovada',
  value: 199.9,
  currency: 'BRL',
  email_hash: 'a'.repeat(64),
  phone_hash: 'b'.repeat(64),
  first_name: 'Cliente',
  last_name: 'Exemplo',
  product_id: '7777',
  product_name: 'Produto',
  fbp: 'fb.1.1758400000000.123',
  fbc: 'fb.1.1758400000000.IwAR',
  ga_client_id: '888.175',
  ga_session_id: '175',
  ip: '203.0.113.45',
  sent_at: null,
};

const CONFIG = {
  settings: {
    currency: 'BRL',
    testEventCode: null,
    cookieDomain: null,
    origensPermitidas: [],
    dominiosCheckout: [],
  },
  ga4: [{ id: 'ga-1', measurementId: 'G-ABC' }],
  pixels: [{ id: 'px-1', pixelId: '111111111111111' }],
};

/** O evento que foi para a Meta, lido com os guards de verdade. */
function payloadMeta(): unknown {
  const corpo: unknown = enviarParaTodosOsPixels.mock.calls[0]?.[0];
  return lista(corpo, 'data')[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  carregarConfiguracao.mockResolvedValue(CONFIG);
  enviarParaTodosOsPixels.mockResolvedValue({ '111111111111111': { ok: true, status: 200 } });
  segredoDoGa4.mockResolvedValue('segredo-ga4');
  maybeSingle.mockResolvedValue({ data: APROVADA });
});

describe('quando dispara', () => {
  it('venda aprovada vai para a Meta', async () => {
    await dispararCompra('yampi:1000001');
    expect(enviarParaTodosOsPixels).toHaveBeenCalledTimes(1);
  });

  /*
   * Pendente ainda pode não acontecer. Mandar antes da hora ensina a Meta a
   * otimizar para gente que gera boleto e não paga.
   */
  it.each(['pendente', 'recusada', 'estornada', 'chargeback'])(
    'NÃO dispara para %s',
    async (status) => {
      maybeSingle.mockResolvedValue({ data: { ...APROVADA, status } });
      await dispararCompra('yampi:1000001');
      expect(enviarParaTodosOsPixels).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  /*
   * O gateway reenvia o mesmo evento, e a Appmax ainda tem retry próprio.
   * Sem esta trava, uma venda viraria três conversões.
   */
  it('NÃO dispara duas vezes — sent_at é o "já mandei?"', async () => {
    maybeSingle.mockResolvedValue({ data: { ...APROVADA, sent_at: '2026-09-21T12:00:00Z' } });
    await dispararCompra('yampi:1000001');
    expect(enviarParaTodosOsPixels).not.toHaveBeenCalled();
  });

  it('compra inexistente não quebra nada', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    await expect(dispararCompra('nao-existe')).resolves.toBeUndefined();
  });
});

describe('o event_id', () => {
  /*
   * Derivado do transaction_id, portanto ESTÁVEL: o mesmo reenvio gera o
   * mesmo id e a Meta deduplica em vez de contar de novo.
   */
  it('é o mesmo para o mesmo pedido, sempre', () => {
    expect(eventIdDaCompra('yampi:1000001')).toBe(eventIdDaCompra('yampi:1000001'));
  });

  it('é diferente entre pedidos', () => {
    expect(eventIdDaCompra('yampi:1')).not.toBe(eventIdDaCompra('yampi:2'));
  });

  it('sobrevive a caractere que a Meta não aceita', () => {
    expect(eventIdDaCompra('loja x/pedido#9')).toMatch(/^[\w.:-]+$/);
  });
});

describe('o payload da Meta', () => {
  it('é Purchase, com valor e moeda', async () => {
    await dispararCompra('yampi:1000001');
    const evento = payloadMeta();
    expect(texto(evento, 'event_name')).toBe('Purchase');
    const custom = objeto(evento, 'custom_data');
    expect(custom?.value).toBe(199.9);
    expect(custom?.currency).toBe('BRL');
    expect(custom?.content_ids).toEqual(['7777']);
  });

  /* O que mais pesa no match, e nenhum gateway conhece: vem do visitante. */
  it('leva fbp e fbc do visitante, em claro', async () => {
    await dispararCompra('yampi:1000001');
    const user = objeto(payloadMeta(), 'user_data');
    expect(user?.fbp).toBe('fb.1.1758400000000.123');
    expect(user?.fbc).toBe('fb.1.1758400000000.IwAR');
    expect(user?.client_ip_address).toBe('203.0.113.45');
  });

  it('usa os hashes prontos do banco', async () => {
    await dispararCompra('yampi:1000001');
    const user = objeto(payloadMeta(), 'user_data');
    expect(user?.em).toEqual(['a'.repeat(64)]);
    expect(user?.ph).toEqual(['b'.repeat(64)]);
  });

  it('em segundos, nunca milissegundos', async () => {
    await dispararCompra('yampi:1000001');
    const segundos = numero(payloadMeta(), 'event_time');
    expect(segundos).toBeDefined();
    // Em milissegundos passaria de 1,7 trilhão.
    expect(segundos).toBeLessThan(2_000_000_000);
  });
});

describe('o GA4', () => {
  /*
   * Sem client_id o GA4 recusa, e inventar um faria a compra abrir sessão
   * nova e aparecer como tráfego direto — desligada do anúncio que a
   * trouxe, que é o oposto do que este projeto faz.
   */
  it('NÃO envia sem client_id, e registra por quê', async () => {
    maybeSingle.mockResolvedValue({ data: { ...APROVADA, ga_client_id: null } });
    await dispararCompra('yampi:1000001');

    const gravado: unknown = update.mock.calls[0]?.[0];
    expect(texto(objeto(gravado, 'response_ga4'), 'ignorado')).toContain('client_id');
    expect(segredoDoGa4).not.toHaveBeenCalled();
  });

  it('envia quando há client_id', async () => {
    await dispararCompra('yampi:1000001');
    expect(segredoDoGa4).toHaveBeenCalledWith('ga-1');
  });
});

describe('o registro', () => {
  it('marca sent_at mesmo com falha num destino', async () => {
    enviarParaTodosOsPixels.mockResolvedValue({
      '111111111111111': { ok: false, status: 0, erro: 'rede' },
    });
    await dispararCompra('yampi:1000001');

    const gravado: unknown = update.mock.calls[0]?.[0];
    // Reenviar sozinho duplicaria a conversão. A falha fica no log, para
    // reenvio manual e deliberado.
    expect(texto(gravado, 'sent_at')).toBeTruthy();
    expect(texto(gravado, 'meta_event_id')).toBe(eventIdDaCompra('yampi:1000001'));
  });
});
