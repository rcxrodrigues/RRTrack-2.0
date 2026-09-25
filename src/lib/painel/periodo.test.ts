import { describe, expect, it } from 'vitest';

import {
  intervaloAnterior,
  intervaloDe,
  lerPeriodo,
  PERIODO_PADRAO,
} from './periodo';

/**
 * O fuso do painel.
 *
 * Isto erra em silêncio e erra todo dia: um "hoje" calculado em UTC mostra
 * três horas de venda e chama isso de dia, e o total não bate com o painel do
 * gateway — que conta em fuso local. Ninguém desconfia de um número que
 * simplesmente é menor.
 */

const SP = 'America/Sao_Paulo';

/** 22/09/2026, 23:30 em São Paulo — que em UTC já é dia 23. */
const NOITE_EM_SP = new Date('2026-09-23T02:30:00Z');

function iso(d: Date): string {
  return d.toISOString();
}

describe('lerPeriodo', () => {
  it('aceita os períodos conhecidos', () => {
    expect(lerPeriodo('hoje')).toBe('hoje');
    expect(lerPeriodo('30d')).toBe('30d');
  });

  it('query string é sugestão: o desconhecido cai no padrão', () => {
    expect(lerPeriodo('ontem-ou-sei-la')).toBe(PERIODO_PADRAO);
    expect(lerPeriodo(undefined)).toBe(PERIODO_PADRAO);
    expect(lerPeriodo('')).toBe(PERIODO_PADRAO);
    // Um array chega quando alguém repete o parâmetro na URL.
    expect(lerPeriodo(['30d', 'hoje'])).toBe('30d');
  });
});

describe('o dia começa no fuso, não em UTC', () => {
  it('"hoje" às 23:30 em SP ainda é o dia 22, não o 23', () => {
    const { de, ate } = intervaloDe('hoje', SP, NOITE_EM_SP);

    // Meia-noite de 22/09 em SP (UTC-3) é 03:00Z do dia 22.
    expect(iso(de)).toBe('2026-09-22T03:00:00.000Z');
    expect(iso(ate)).toBe('2026-09-23T03:00:00.000Z');
  });

  /*
   * O erro que isto impede, dito em número: com o dia em UTC, "hoje" às
   * 23:30 de São Paulo começaria à meia-noite UTC — 21h local — e mostraria
   * duas horas e meia de venda no lugar de um dia.
   */
  it('e o intervalo cobre 24 horas, não as horas que sobraram do dia UTC', () => {
    const { de, ate } = intervaloDe('hoje', SP, NOITE_EM_SP);
    expect(ate.getTime() - de.getTime()).toBe(86_400_000);
  });

  it('em UTC o mesmo instante já é o dia seguinte', () => {
    const { de } = intervaloDe('hoje', 'UTC', NOITE_EM_SP);
    expect(iso(de)).toBe('2026-09-23T00:00:00.000Z');
  });

  it('"ontem" encosta em "hoje" sem sobrepor', () => {
    const hoje = intervaloDe('hoje', SP, NOITE_EM_SP);
    const ontem = intervaloDe('ontem', SP, NOITE_EM_SP);

    // O fim de ontem é o começo de hoje. Como `ate` é exclusivo, nenhum
    // registro cai nos dois — somar os dois períodos dá dois dias exatos.
    expect(iso(ontem.ate)).toBe(iso(hoje.de));
    expect(ontem.dias).toBe(1);
  });
});

describe('as janelas', () => {
  it('"7 dias" são sete, incluindo hoje', () => {
    const { de, ate, dias } = intervaloDe('7d', SP, NOITE_EM_SP);
    expect(dias).toBe(7);
    // 16/09 00:00 SP até 23/09 00:00 SP.
    expect(iso(de)).toBe('2026-09-16T03:00:00.000Z');
    expect(iso(ate)).toBe('2026-09-23T03:00:00.000Z');
  });

  it('"30 dias" são trinta, incluindo hoje', () => {
    expect(intervaloDe('30d', SP, NOITE_EM_SP).dias).toBe(30);
  });

  it('"este mês" começa no dia 1º, no fuso', () => {
    const { de, dias } = intervaloDe('mes', SP, NOITE_EM_SP);
    expect(iso(de)).toBe('2026-09-01T03:00:00.000Z');
    // Dia 1 até o fim do dia 22 são 22 dias.
    expect(dias).toBe(22);
  });

  it('atravessa a virada do mês sem estourar', () => {
    // 1º de março de 2027, 00:30 em SP.
    const primeiroDeMarco = new Date('2027-03-01T03:30:00Z');
    const { de, dias } = intervaloDe('7d', SP, primeiroDeMarco);

    // Sete dias contando o dia 1º levam a 23/02 — e 2027 não é bissexto.
    expect(iso(de)).toBe('2027-02-23T03:00:00.000Z');
    expect(dias).toBe(7);
  });
});

/*
 * O Brasil não tem horário de verão desde 2019, mas este código não pode
 * assumir isso: a próxima oferta pode ser em outro país, e o erro seria de
 * uma hora em dois dias do ano — o tipo de coisa que ninguém encontra
 * depois. Nova York serve de prova porque ainda vira.
 */
describe('horário de verão', () => {
  const NY = 'America/New_York';

  it('o dia que PERDE uma hora tem 23, e o intervalo acompanha', () => {
    // 8 de março de 2026 é a virada para o horário de verão em NY.
    const naVirada = new Date('2026-03-08T18:00:00Z');
    const { de, ate } = intervaloDe('hoje', NY, naVirada);

    // 8/03 00:00 EST (UTC-5) = 05:00Z; 9/03 00:00 EDT (UTC-4) = 04:00Z.
    expect(iso(de)).toBe('2026-03-08T05:00:00.000Z');
    expect(iso(ate)).toBe('2026-03-09T04:00:00.000Z');
    expect(ate.getTime() - de.getTime()).toBe(23 * 3_600_000);
  });

  it('o dia que GANHA uma hora tem 25', () => {
    // 1º de novembro de 2026, volta para o padrão.
    const naVirada = new Date('2026-11-01T18:00:00Z');
    const { de, ate } = intervaloDe('hoje', NY, naVirada);

    expect(ate.getTime() - de.getTime()).toBe(25 * 3_600_000);
  });

  it('e "dias" continua contando dias, não períodos de 24h', () => {
    const naVirada = new Date('2026-03-08T18:00:00Z');
    // Sete dias de calendário, um deles com 23 horas: 7, não 6,96.
    expect(intervaloDe('7d', NY, naVirada).dias).toBe(7);
  });
});

describe('intervaloAnterior', () => {
  it('tem a mesma duração e encosta sem sobrepor', () => {
    const atual = intervaloDe('7d', SP, NOITE_EM_SP);
    const antes = intervaloAnterior(atual);

    expect(iso(antes.ate)).toBe(iso(atual.de));
    expect(antes.ate.getTime() - antes.de.getTime()).toBe(
      atual.ate.getTime() - atual.de.getTime(),
    );
  });

  it('para "hoje", o anterior é ontem', () => {
    const antes = intervaloAnterior(intervaloDe('hoje', SP, NOITE_EM_SP));
    expect(iso(antes.de)).toBe('2026-09-21T03:00:00.000Z');
  });
});
