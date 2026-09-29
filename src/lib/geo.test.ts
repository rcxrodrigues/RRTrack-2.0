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

/**
 * O CASO QUE FALTAVA — e que é o que acontece de verdade.
 *
 * O teste antigo cobria "a Vercel não mandou nada". Com a nuvem laranja os
 * DOIS conjuntos chegam, e aí a ordem decide: os cabeçalhos da Vercel
 * descrevem a BORDA DO CLOUDFLARE, não o visitante. Preferindo a Vercel, um
 * visitante de Minas Gerais aparecia em The Dalles, Oregon — com o IP certo,
 * porque `extrairIp` já lia `cf-connecting-ip` primeiro. O mesmo arquivo se
 * contradizia, e só o caso não testado expunha isso.
 */
describe('com o Cloudflare na frente, quem viu o visitante ganha', () => {
  const comOsDois = new Headers({
    'cf-connecting-ip': '189.4.1.10',
    // O que o Cloudflare diz do VISITANTE.
    'cf-ipcountry': 'BR',
    'cf-region-code': 'MG',
    'cf-ipcity': 'Belo Horizonte',
    // O que a Vercel diz da BORDA do Cloudflare.
    'x-vercel-ip-country': 'US',
    'x-vercel-ip-country-region': 'OR',
    'x-vercel-ip-city': 'The Dalles',
    'x-forwarded-for': '104.16.0.1',
  });

  it('o geo é o do visitante, não o do datacenter', () => {
    const geo = extrairGeo(comOsDois);
    expect(geo.pais).toBe('BR');
    expect(geo.regiao).toBe('MG');
    expect(geo.cidade).toBe('Belo Horizonte');
  });

  it('e o IP também — os dois passam a concordar', () => {
    // Era aqui que a contradição aparecia: IP brasileiro, geo americano.
    expect(extrairGeo(comOsDois).ip).toBe('189.4.1.10');
  });

  it('o Cloudflare manda só o país por padrão, e isso é honesto', () => {
    // Região e cidade exigem ligar o managed transform "Add visitor location
    // headers". Sem ele o visitante chega com país e sem o resto — que na
    // árvore vira "Não informado", em vez de um datacenter que mente.
    const soPais = new Headers({
      'cf-connecting-ip': '189.4.1.10',
      'cf-ipcountry': 'BR',
      'x-vercel-ip-country': 'US',
      'x-vercel-ip-country-region': 'OR',
      'x-vercel-ip-city': 'The Dalles',
    });
    const geo = extrairGeo(soPais);
    expect(geo.pais).toBe('BR');
    expect(geo.regiao).toBeNull();
    expect(geo.cidade).toBeNull();
  });

  it('sem Cloudflare na frente, a Vercel continua mandando', () => {
    // A nuvem CINZA é a configuração recomendada, e ali a Vercel vê o
    // visitante de verdade. A correção não pode inverter esse caso.
    const soVercel = new Headers({
      'x-vercel-ip-country': 'BR',
      'x-vercel-ip-country-region': 'MG',
      'x-vercel-ip-city': 'Belo Horizonte',
      'x-forwarded-for': '189.4.1.10',
    });
    const geo = extrairGeo(soVercel);
    expect(geo.pais).toBe('BR');
    expect(geo.regiao).toBe('MG');
    expect(geo.cidade).toBe('Belo Horizonte');
    expect(geo.ip).toBe('189.4.1.10');
  });
});
