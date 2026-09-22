import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { montarSnippet } from './snippet';
import type { Configuracao } from './settings';

const CONFIG: Configuracao = {
  settings: {
    currency: 'BRL',
    testEventCode: 'TEST123',
    cookieDomain: '.transforlar.com',
    origensPermitidas: ['https://transforlar.com'],
    dominiosCheckout: [{ dominio: 'seguro.transforlar.com', parametro: 'trck_user_id' }],
    statusPorAlias: {},
  },
  ga4: [
    { id: '1', measurementId: 'G-ABC123' },
    { id: '2', measurementId: 'G-XYZ789' },
  ],
  pixels: [
    { id: '1', pixelId: '111111111111111' },
    { id: '2', pixelId: '222222222222222' },
  ],
};

const snippet = montarSnippet('https://track.transforlar.com', CONFIG);

describe('montarSnippet', () => {
  it('embute todos os measurement ids e pixels ativos', () => {
    expect(snippet).toContain('G-ABC123');
    expect(snippet).toContain('G-XYZ789');
    expect(snippet).toContain('111111111111111');
    expect(snippet).toContain('222222222222222');
  });

  it('aponta para a base recebida', () => {
    expect(snippet).toContain('https://track.transforlar.com');
  });

  // O snippet é público: qualquer visitante pode abrir /t.js e ler.
  it('NÃO vaza nenhum segredo', () => {
    expect(snippet).not.toContain('TEST123');
    expect(snippet).not.toContain('service_role');
    expect(snippet).not.toContain('sb_secret');
    expect(snippet).not.toContain('api_secret');
    expect(snippet).not.toContain('capi_token');
  });

  it('manda o cookie junto — sem credentials, o _trck não viaja', () => {
    expect(snippet).toContain("credentials: 'include'");
  });

  it('usa o mesmo event_id no Pixel e no servidor — é o que deduplica', () => {
    expect(snippet).toContain('eventID: eventId');
    expect(snippet).toContain('event_id: eventId');
  });

  it('expõe a API pública', () => {
    for (const metodo of ['api.track', 'api.identify', 'api.id', 'api.marcarLinks']) {
      expect(snippet).toContain(metodo);
    }
  });

  it('é JavaScript sintaticamente válido', () => {
    // `new vm.Script` compila SEM executar: pega erro de sintaxe, que num
    // arquivo servido para o site do cliente seria uma página quebrada.
    expect(() => new vm.Script(snippet)).not.toThrow();
  });

  it('não vaza nada no escopo global além de rrtrack', () => {
    expect(snippet).toContain('w.rrtrack = api');
    expect(snippet).toContain("(function (w, d) {");
  });

  it('embute os domínios de checkout cadastrados', () => {
    expect(snippet).toContain('seguro.transforlar.com');
  });

  it('funciona sem nenhum destino configurado', () => {
    const vazio = montarSnippet('https://x.com', {
      settings: { ...CONFIG.settings, dominiosCheckout: [] },
      ga4: [],
      pixels: [],
    });
    expect(() => new vm.Script(vazio)).not.toThrow();
    expect(vazio).toContain('CFG.ga4.length');
  });
});
