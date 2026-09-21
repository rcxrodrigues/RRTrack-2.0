import { describe, expect, it } from 'vitest';

import { ehIpValido, extrairGeo, extrairIp } from './geo';

/** Um `headers` de mentira, com as chaves em minúsculas como no runtime. */
function cabecalhos(mapa: Record<string, string>) {
  const normalizado = new Map(
    Object.entries(mapa).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (nome: string) => normalizado.get(nome.toLowerCase()) ?? null };
}

describe('ehIpValido', () => {
  it('aceita IPv4 e IPv6', () => {
    for (const ip of ['1.2.3.4', '192.168.0.1', '255.255.255.255', '2001:db8::1', '::1']) {
      expect(ehIpValido(ip), ip).toBe(true);
    }
  });

  it('recusa o que não é IP', () => {
    for (const v of ['', '1.2.3', '1.2.3.256', 'abc', '1.2.3.4.5', '<script>', '999.1.1.1']) {
      expect(ehIpValido(v), v).toBe(false);
    }
  });
});

describe('extrairIp', () => {
  it('prefere o cabeçalho do Cloudflare quando ele está na frente', () => {
    const h = cabecalhos({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.1, 203.0.113.7',
    });
    expect(extrairIp(h)).toBe('203.0.113.7');
  });

  it('usa o primeiro da lista do x-forwarded-for', () => {
    const h = cabecalhos({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' });
    expect(extrairIp(h)).toBe('203.0.113.7');
  });

  // O cliente controla o começo da lista; um valor inválido não pode virar
  // um IP guardado no banco nem ser enviado à Meta como client_ip_address.
  it('ignora valor forjado e cai no próximo candidato', () => {
    const h = cabecalhos({ 'x-forwarded-for': 'não-é-ip, 203.0.113.7' });
    expect(extrairIp(h)).toBeNull();
  });

  it('devolve null quando não há cabeçalho nenhum (é o caso do dev local)', () => {
    expect(extrairIp(cabecalhos({}))).toBeNull();
  });
});

describe('extrairGeo', () => {
  it('lê os cabeçalhos da Vercel', () => {
    const h = cabecalhos({
      'x-forwarded-for': '203.0.113.7',
      'x-vercel-ip-country': 'BR',
      'x-vercel-ip-country-region': 'SP',
      'x-vercel-ip-city': 'Sao Paulo',
    });
    expect(extrairGeo(h)).toEqual({
      ip: '203.0.113.7',
      pais: 'BR',
      regiao: 'SP',
      cidade: 'Sao Paulo',
    });
  });

  // A Vercel manda a cidade percent-encoded; sem decodificar, o mapa
  // mostraria "S%C3%A3o%20Paulo".
  it('decodifica o nome da cidade', () => {
    const h = cabecalhos({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' });
    expect(extrairGeo(h).cidade).toBe('São Paulo');
  });

  it('aguenta percent-encoding quebrado sem perder o dado', () => {
    const h = cabecalhos({ 'x-vercel-ip-city': 'Rio%%%' });
    expect(extrairGeo(h).cidade).toBe('Rio%%%');
  });

  it('lê os cabeçalhos do Cloudflare quando a Vercel não os manda', () => {
    const h = cabecalhos({
      'cf-connecting-ip': '198.51.100.9',
      'cf-ipcountry': 'pt',
      'cf-ipcity': 'Lisboa',
    });
    const geo = extrairGeo(h);
    expect(geo.ip).toBe('198.51.100.9');
    expect(geo.pais).toBe('PT');
    expect(geo.cidade).toBe('Lisboa');
  });

  it('trata o XX do Cloudflare como desconhecido, não como um país', () => {
    expect(extrairGeo(cabecalhos({ 'cf-ipcountry': 'XX' })).pais).toBeNull();
    expect(extrairGeo(cabecalhos({ 'cf-ipcountry': 'T1' })).pais).toBeNull();
  });

  it('devolve tudo nulo em ambiente local, sem quebrar', () => {
    expect(extrairGeo(cabecalhos({}))).toEqual({
      ip: null, pais: null, regiao: null, cidade: null,
    });
  });
});
