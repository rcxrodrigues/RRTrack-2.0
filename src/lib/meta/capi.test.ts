import { describe, expect, it } from 'vitest';

import { montarPayload, montarUserData } from './capi';

/**
 * O que estes testes protegem é a coisa mais silenciosa do projeto: a Meta
 * não recusa um `user_data` mal montado. Ela aceita, devolve 200, e entrega
 * um match pior — sem erro, sem aviso, sem nada no log.
 */

const COMPLETO = {
  emailHash: 'a'.repeat(64),
  phoneHash: 'b'.repeat(64),
  firstNameHash: 'c'.repeat(64),
  lastNameHash: 'd'.repeat(64),
  cityHash: 'e'.repeat(64),
  stateHash: 'f'.repeat(64),
  countryHash: '0'.repeat(64),
  externalIdHash: '1'.repeat(64),
  fbp: 'fb.1.1758400000000.1234567890',
  fbc: 'fb.1.1758400000000.IwAR-abc',
  ip: '203.0.113.45',
  userAgent: 'Mozilla/5.0 (iPhone)',
};

describe('montarUserData', () => {
  it('manda os hasheados em array, como a Meta documenta', () => {
    const u = montarUserData(COMPLETO);
    for (const chave of ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'country', 'external_id'] as const) {
      expect(Array.isArray(u[chave]), chave).toBe(true);
    }
    expect(u.em).toEqual([COMPLETO.emailHash]);
  });

  /*
   * O ponto mais importante do arquivo. Hashear qualquer um destes quatro os
   * torna inúteis: a Meta precisa do VALOR para cruzar com o que ela mesma
   * observou no navegador e na rede.
   */
  it('NÃO hasheia fbp, fbc, IP nem user agent', () => {
    const u = montarUserData(COMPLETO);
    expect(u.fbp).toBe('fb.1.1758400000000.1234567890');
    expect(u.fbc).toBe('fb.1.1758400000000.IwAR-abc');
    expect(u.client_ip_address).toBe('203.0.113.45');
    expect(u.client_user_agent).toBe('Mozilla/5.0 (iPhone)');
  });

  it('IP e user agent sempre vão, quando existem', () => {
    const u = montarUserData({ ip: '198.51.100.1', userAgent: 'curl/8' });
    expect(u.client_ip_address).toBe('198.51.100.1');
    expect(u.client_user_agent).toBe('curl/8');
  });

  // Chave presente com valor vazio é pior que chave ausente: a Meta conta
  // como campo enviado e a qualidade do match cai no Events Manager.
  it('não cria chave para o que não tem valor', () => {
    const u = montarUserData({ emailHash: 'a'.repeat(64) });
    expect(Object.keys(u)).toEqual(['em']);
    expect('ph' in u).toBe(false);
    expect('fbp' in u).toBe(false);
  });

  it('visitante sem nada nenhum vira objeto vazio, não objeto de nulos', () => {
    const u = montarUserData({});
    expect(u).toEqual({});
    expect(JSON.stringify(u)).toBe('{}');
  });

  it('trata null e undefined igual — os dois são ausência', () => {
    const comNull = montarUserData({ emailHash: null, fbp: null });
    const comUndefined = montarUserData({ emailHash: undefined, fbp: undefined });
    expect(comNull).toEqual(comUndefined);
  });

  it('string vazia também é ausência', () => {
    expect(montarUserData({ emailHash: '', fbp: '' })).toEqual({});
  });
});

describe('montarPayload', () => {
  const evento = {
    event_name: 'Purchase',
    event_time: 1_758_400_000,
    event_id: 'evt-001',
    action_source: 'website' as const,
    user_data: montarUserData(COMPLETO),
  };

  it('embrulha o evento em data[]', () => {
    const p = montarPayload(evento, null);
    expect(p.data).toHaveLength(1);
    expect(p.data[0]?.event_id).toBe('evt-001');
  });

  // O código de teste vai no TOPO do corpo, não dentro do evento. Dentro,
  // a Meta ignora e o evento conta como conversão de verdade.
  it('põe o test_event_code no topo quando há um', () => {
    const p = montarPayload(evento, 'TEST12345');
    expect(p.test_event_code).toBe('TEST12345');
  });

  /*
   * Código de teste esquecido em produção manda TODA conversão para Test
   * Events, onde ela não conta — o otimizador da Meta para de aprender e a
   * campanha morre sem ninguém entender por quê.
   */
  it('OMITE o test_event_code quando não há — nunca manda vazio', () => {
    for (const vazio of [null, undefined, '']) {
      const p = montarPayload(evento, vazio);
      expect('test_event_code' in p, String(vazio)).toBe(false);
    }
  });

  it('o payload gravado não carrega o token', () => {
    const p = montarPayload(evento, 'TEST12345');
    expect(JSON.stringify(p)).not.toContain('access_token');
  });
});
