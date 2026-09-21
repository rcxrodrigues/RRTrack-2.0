import { describe, expect, it } from 'vitest';

import { montarPayloadGa4 } from './mp';

/**
 * O Measurement Protocol é o oposto da Meta em diagnóstico: ele responde 204
 * para quase tudo, inclusive para payload errado. Se o corpo estiver mal
 * montado, nada avisa — o evento simplesmente não aparece no relatório.
 */

const EVENTO = { name: 'purchase', params: { value: 197.5, currency: 'BRL' } };

describe('montarPayloadGa4', () => {
  it('leva o client_id da visita', () => {
    const p = montarPayloadGa4({ clientId: '888777666.1758400000', eventos: [EVENTO] });
    expect(p.client_id).toBe('888777666.1758400000');
  });

  /*
   * Sem o session_id, o GA4 abre uma sessão nova e a compra vira tráfego
   * direto — desligada do anúncio que a trouxe, que é o problema inteiro
   * que este projeto existe para resolver.
   */
  it('põe o session_id DENTRO de params, que é onde o GA4 lê', () => {
    const p = montarPayloadGa4({
      clientId: 'c1',
      sessionId: '1758400000',
      eventos: [EVENTO],
    });
    expect(p.events[0]?.params.session_id).toBe('1758400000');
    // No topo do corpo o GA4 ignora — tem de estar em params.
    expect('session_id' in p).toBe(false);
  });

  it('omite o session_id quando não há — nunca manda vazio', () => {
    for (const vazio of [null, undefined]) {
      const p = montarPayloadGa4({ clientId: 'c1', sessionId: vazio, eventos: [EVENTO] });
      expect('session_id' in (p.events[0]?.params ?? {}), String(vazio)).toBe(false);
    }
  });

  // Sem isto o GA4 marca a sessão como não engajada e a atribuição se perde.
  it('manda engagement_time_msec em todo evento', () => {
    const p = montarPayloadGa4({ clientId: 'c1', eventos: [EVENTO, EVENTO] });
    for (const e of p.events) expect(e.params.engagement_time_msec).toBe('1');
  });

  it('preserva os parâmetros do evento', () => {
    const p = montarPayloadGa4({ clientId: 'c1', eventos: [EVENTO] });
    expect(p.events[0]?.name).toBe('purchase');
    expect(p.events[0]?.params.value).toBe(197.5);
    expect(p.events[0]?.params.currency).toBe('BRL');
  });

  it('só inclui timestamp_micros quando recebe um', () => {
    expect('timestamp_micros' in montarPayloadGa4({ clientId: 'c1', eventos: [] })).toBe(false);
    const p = montarPayloadGa4({ clientId: 'c1', eventos: [], timestampMicros: 1_758_400_000_000_000 });
    expect(p.timestamp_micros).toBe(1_758_400_000_000_000);
  });
});
