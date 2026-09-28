import { describe, expect, it } from 'vitest';

import {
  comPeriodo,
  ehFaixa,
  escolhaDaQuery,
  intervaloAnterior,
  intervaloDe,
  lerEscolha,
  MAXIMO_DE_DIAS,
  paramsDaEscolha,
  PERIODO_PADRAO,
  rotuloDaEscolha,
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

describe('lerEscolha', () => {
  it('aceita os períodos conhecidos', () => {
    expect(lerEscolha({ periodo: 'hoje' })).toBe('hoje');
    expect(lerEscolha({ periodo: '30d' })).toBe('30d');
  });

  it('query string é sugestão: o desconhecido cai no padrão', () => {
    expect(lerEscolha({ periodo: 'ontem-ou-sei-la' })).toBe(PERIODO_PADRAO);
    expect(lerEscolha({})).toBe(PERIODO_PADRAO);
    expect(lerEscolha({ periodo: '' })).toBe(PERIODO_PADRAO);
    // Um array chega quando alguém repete o parâmetro na URL.
    expect(lerEscolha({ periodo: ['30d', 'hoje'] })).toBe('30d');
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

/*
 * A escolha de período tinha de sobreviver à troca de aba.
 *
 * Link de menu é caminho puro, então quem estava olhando 30 dias no
 * faturamento chegava à visão geral vendo HOJE — sem nada na tela dizendo
 * que o intervalo mudou debaixo dele. Dois números de períodos diferentes
 * lidos como se fossem do mesmo.
 */
describe('comPeriodo', () => {
  it('carrega o período escolhido para a próxima aba', () => {
    expect(comPeriodo('/faturamento', '30d')).toBe('/faturamento?periodo=30d');
  });

  it('omite o padrão — URL limpa é o estado inicial', () => {
    expect(comPeriodo('/eventos', PERIODO_PADRAO)).toBe('/eventos');
  });

  it('a FAIXA também atravessa a troca de aba', () => {
    // O modo de falha que `comPeriodo` existe para evitar, agora pela porta
    // nova: escolher 1 a 15 de setembro no faturamento e chegar à visão
    // geral vendo hoje, sem nada dizendo que o intervalo mudou.
    expect(
      comPeriodo('/faturamento', { de: '2026-09-01', ate: '2026-09-15' }),
    ).toBe('/faturamento?de=2026-09-01&ate=2026-09-15');
  });

  it('lixo na query cai no padrão em vez de ser propagado', () => {
    expect(comPeriodo('/eventos', lerEscolha({ periodo: 'drop table' }))).toBe(
      '/eventos',
    );
    expect(comPeriodo('/eventos', lerEscolha({}))).toBe('/eventos');
  });

  it('o padrão ao abrir é HOJE, não sete dias', () => {
    expect(PERIODO_PADRAO).toBe('hoje');
    expect(lerEscolha({})).toBe('hoje');
  });
});

/**
 * A faixa escolhida à mão.
 *
 * Duas armadilhas moram aqui, e as duas erram calado:
 *
 *   1. O FUSO. "1º de setembro" é um dia do calendário, não um instante.
 *      Tratado como UTC, a faixa de quem está em São Paulo começa às 21h do
 *      dia 31 de agosto — e três horas de venda do dia errado entram na conta.
 *   2. O INCLUSIVO. Quem escolhe "1 a 15" quer o dia 15 inteiro. Sem o `+1`,
 *      o dia 15 fica de fora e o painel mostra 14 dias chamando de 15.
 */
describe('faixa de datas', () => {
  it('lê `de` e `ate` da query', () => {
    const e = lerEscolha({ de: '2026-09-01', ate: '2026-09-15' });
    expect(ehFaixa(e)).toBe(true);
    expect(e).toEqual({ de: '2026-09-01', ate: '2026-09-15' });
  });

  it('o dia final entra INTEIRO — a faixa é inclusiva', () => {
    const i = intervaloDe({ de: '2026-09-01', ate: '2026-09-15' }, SP);
    // 1º de setembro, 00:00 em SP = 03:00 UTC.
    expect(iso(i.de)).toBe('2026-09-01T03:00:00.000Z');
    // O fim é a meia-noite do dia 16: o dia 15 inteiro está dentro.
    expect(iso(i.ate)).toBe('2026-09-16T03:00:00.000Z');
    expect(i.dias).toBe(15);
  });

  it('um dia só é um dia, não zero', () => {
    const i = intervaloDe({ de: '2026-09-22', ate: '2026-09-22' }, SP);
    expect(i.dias).toBe(1);
    expect(i.ate.getTime() - i.de.getTime()).toBe(86_400_000);
  });

  it('começa no fuso do painel, não em UTC', () => {
    const i = intervaloDe({ de: '2026-09-01', ate: '2026-09-01' }, SP);
    // Em UTC a meia-noite de SP é 03:00 — não 00:00. Tratada como UTC, a
    // faixa pegaria as três primeiras horas do dia 1º em UTC, que em SP
    // ainda são 31 de agosto.
    expect(iso(i.de)).toBe('2026-09-01T03:00:00.000Z');
    expect(iso(i.de)).not.toBe('2026-09-01T00:00:00.000Z');
  });

  it('a faixa não olha o relógio: o "agora" não muda nada', () => {
    const a = intervaloDe({ de: '2026-01-05', ate: '2026-01-09' }, SP, NOITE_EM_SP);
    const b = intervaloDe(
      { de: '2026-01-05', ate: '2026-01-09' },
      SP,
      new Date('2030-06-01T12:00:00Z'),
    );
    expect(iso(a.de)).toBe(iso(b.de));
    expect(iso(a.ate)).toBe(iso(b.ate));
  });

  it('o "período anterior" de uma faixa tem a mesma duração e encosta', () => {
    const atual = intervaloDe({ de: '2026-09-11', ate: '2026-09-20' }, SP);
    const antes = intervaloAnterior(atual);
    expect(iso(antes.ate)).toBe(iso(atual.de));
    expect(antes.ate.getTime() - antes.de.getTime()).toBe(
      atual.ate.getTime() - atual.de.getTime(),
    );
  });
});

describe('a faixa que não vale cai no padrão', () => {
  const invalidas: [string, Record<string, string>][] = [
    ['dia que não existe no calendário', { de: '2026-02-31', ate: '2026-03-05' }],
    ['formato errado', { de: '01/09/2026', ate: '15/09/2026' }],
    ['de depois de ate', { de: '2026-09-15', ate: '2026-09-01' }],
    ['só uma das pontas', { de: '2026-09-01' }],
    ['texto no lugar de data', { de: 'ontem', ate: 'hoje' }],
    ['mês zero', { de: '2026-00-10', ate: '2026-01-10' }],
  ];

  for (const [caso, params] of invalidas) {
    it(`recusa: ${caso}`, () => {
      expect(lerEscolha(params)).toBe(PERIODO_PADRAO);
    });
  }

  it(`recusa faixa maior que ${String(MAXIMO_DE_DIAS)} dias`, () => {
    // A Meta recusa `time_range` além de 37 meses, e o "vs período anterior"
    // de uma faixa de cinco anos compara com anos que talvez não existam.
    expect(lerEscolha({ de: '2020-01-01', ate: '2026-01-01' })).toBe(
      PERIODO_PADRAO,
    );
  });

  it('aceita exatamente o teto', () => {
    // 2026 não é bissexto: 01/01/2026 a 01/01/2027 dá 366 dias contando as
    // duas pontas. O limite é `<=`, então este passa e um dia a mais não.
    expect(lerEscolha({ de: '2026-01-01', ate: '2027-01-01' })).toEqual({
      de: '2026-01-01',
      ate: '2027-01-01',
    });
    expect(lerEscolha({ de: '2026-01-01', ate: '2027-01-02' })).toBe(
      PERIODO_PADRAO,
    );
  });

  it('a faixa ganha do atalho quando os dois vêm na URL', () => {
    // É o que o formulário manda: os campos de data mais o `periodo` que
    // estava na tela. Ignorar a faixa ali faria o botão não fazer nada.
    expect(
      lerEscolha({ periodo: '30d', de: '2026-09-01', ate: '2026-09-15' }),
    ).toEqual({ de: '2026-09-01', ate: '2026-09-15' });
  });

  it('faixa quebrada não derruba o atalho que veio junto', () => {
    expect(lerEscolha({ periodo: '30d', de: 'lixo', ate: '2026-09-15' })).toBe(
      '30d',
    );
  });
});

describe('a escolha vira URL e volta', () => {
  it('ida e volta pelos parâmetros', () => {
    for (const escolha of [
      'hoje',
      '30d',
      { de: '2026-09-01', ate: '2026-09-15' },
    ] as const) {
      expect(lerEscolha(paramsDaEscolha(escolha))).toEqual(escolha);
    }
  });

  it('escolhaDaQuery lê o mesmo que lerEscolha', () => {
    const query = new URLSearchParams({ de: '2026-09-01', ate: '2026-09-15' });
    expect(escolhaDaQuery(query)).toEqual({
      de: '2026-09-01',
      ate: '2026-09-15',
    });
    expect(escolhaDaQuery(new URLSearchParams({ periodo: '7d' }))).toBe('7d');
    expect(escolhaDaQuery(new URLSearchParams())).toBe(PERIODO_PADRAO);
  });
});

describe('o rótulo da faixa', () => {
  it('mostra dia e mês quando é o mesmo ano', () => {
    expect(rotuloDaEscolha({ de: '2026-09-01', ate: '2026-09-15' })).toBe(
      '01/09 – 15/09',
    );
  });

  it('acrescenta o ano quando a faixa atravessa dezembro', () => {
    expect(rotuloDaEscolha({ de: '2025-12-20', ate: '2026-01-05' })).toBe(
      '20/12/25 – 05/01/26',
    );
  });

  it('atalho continua com o rótulo de sempre', () => {
    expect(rotuloDaEscolha('7d')).toBe('7 dias');
  });
});
