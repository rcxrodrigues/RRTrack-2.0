import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ehRobo, MARCAS_DE_ROBO } from './robo';

/*
 * Agentes de GENTE. Se um destes virar `true`, um comprador real sai da
 * conta e do que vai para a Meta — é o erro que esta lista existe para não
 * cometer, e o que ninguém notaria, porque o funil só ficaria menor.
 */
const GENTE = {
  'iPhone Safari':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Android Chrome':
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  // CUBOT é marca de celular vendida no Brasil, e tem "bot" no nome.
  'Android num CUBOT':
    'Mozilla/5.0 (Linux; Android 11; CUBOT_NOTE_20 Build/RP1A.200720.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
  'Windows Chrome':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mac Safari':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  Firefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Samsung Internet':
    'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  // Navegador embutido de aplicativo — por onde chega boa parte do tráfego
  // desta loja. Nenhum deles carrega a palavra "whatsapp" nem "bot".
  'Instagram embutido':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.25.97',
  'Facebook embutido':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/468.0.0.35.108]',
};

/** Agentes de robô, dos que de fato aparecem numa loja aberta. */
const ROBOS = {
  Googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Googlebot celular':
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'AdsBot do Google':
    'AdsBot-Google (+http://www.google.com/adsbot.html)',
  Bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'prévia de link do Facebook':
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'prévia de link do WhatsApp': 'WhatsApp/2.23.20.0 A',
  AhrefsBot:
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  Lighthouse:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Chrome-Lighthouse',
  'Chrome sem cabeça':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
  curl: 'curl/8.4.0',
  'requests do Python': 'python-requests/2.31.0',
  'robô que ainda não existe':
    'Mozilla/5.0 (compatible; AlgumaCoisaNova/1.0; +http://exemplo.com/sobre)',
};

describe('ehRobo', () => {
  it('não marca gente', () => {
    for (const [quem, ua] of Object.entries(GENTE)) {
      expect(ehRobo(ua), quem).toBe(false);
    }
  });

  it('marca robô', () => {
    for (const [quem, ua] of Object.entries(ROBOS)) {
      expect(ehRobo(ua), quem).toBe(true);
    }
  });

  it('agente ausente NÃO é robô', () => {
    // Suspeito, não provado. Extensão de privacidade também remove o
    // cabeçalho, e marcar por ausência trocaria suspeita por afirmação.
    expect(ehRobo(null)).toBe(false);
    expect(ehRobo(undefined)).toBe(false);
    expect(ehRobo('')).toBe(false);
  });

  it('a caixa não importa', () => {
    expect(ehRobo('GOOGLEBOT/2.1')).toBe(true);
    expect(ehRobo('GoogleBot/2.1')).toBe(true);
  });

  it('nenhuma marca tem metacaractere de regex', () => {
    // A busca aqui é substring, mas a MESMA lista vira regex no SQL do
    // preenchimento retroativo. Um `.` ou `(` solto mudaria o sentido lá
    // sem mudar nada aqui — e o preenchimento erraria calado.
    for (const m of MARCAS_DE_ROBO) {
      expect(m, m).toMatch(/^[a-z0-9 /+-]+$/);
    }
  });
});

/*
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ A LISTA É UMA SÓ, E O SQL TEM DE CARREGAR A MESMA.                      │
 * │                                                                         │
 * │ A migration marca retroativamente quem já estava no banco, e para isso  │
 * │ repete as marcas numa regex. Duas listas que podem divergir é o que      │
 * │ este projeto evita em todo lugar — então aqui não é prosa pedindo        │
 * │ cuidado: é teste que quebra o build quando uma marca entra só de um      │
 * │ lado. No molde do `constants.test.ts`.                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
describe('a lista do SQL não diverge da daqui', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261001100000_robo_fora_da_conta.sql'),
    'utf8',
  );

  it('toda marca daqui está na regex da migration', () => {
    for (const m of MARCAS_DE_ROBO) {
      expect(sql, `marca ausente no SQL: ${m}`).toContain(m);
    }
  });

  it('e a exceção do CUBOT também', () => {
    expect(sql).toContain('cubot');
  });
});
