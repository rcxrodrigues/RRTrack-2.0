/**
 * O filtro de período do painel.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ "Hoje" não é uma pergunta sobre UTC. O servidor roda em UTC (a Vercel    │
 * │ roda); quem olha o painel está num fuso. Às 21h em São Paulo já é o dia  │
 * │ seguinte em UTC — então um "hoje" ingênuo mostraria três horas de venda  │
 * │ e chamaria isso de dia.                                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Aqui o período é traduzido para DOIS INSTANTES (`de` e `ate`), calculados
 * no fuso configurado. O banco só soma entre eles — ele não precisa saber de
 * fuso nenhum, e por isso não erra.
 *
 * `ate` é EXCLUSIVO. Com limite inclusivo o último milissegundo do dia
 * entraria em dois períodos ao mesmo tempo, e "hoje" mais "ontem" somariam
 * mais que os dois dias juntos.
 */

export const PERIODOS = ['hoje', 'ontem', '7d', '30d', 'mes'] as const;

export type Periodo = (typeof PERIODOS)[number];

export const ROTULOS: Record<Periodo, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7d': '7 dias',
  '30d': '30 dias',
  mes: 'Este mês',
};

export const PERIODO_PADRAO: Periodo = '7d';

export type Intervalo = {
  periodo: Periodo;
  /** Início, inclusivo. */
  de: Date;
  /** Fim, EXCLUSIVO. */
  ate: Date;
  fuso: string;
  /** Quantos dias o intervalo cobre — o gráfico usa para escolher o passo. */
  dias: number;
};

function ehPeriodo(valor: string | undefined): valor is Periodo {
  return valor !== undefined && (PERIODOS as readonly string[]).includes(valor);
}

/** O que veio na URL, ou o padrão. Nunca lança: query string é sugestão. */
export function lerPeriodo(valor: string | string[] | undefined): Periodo {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return ehPeriodo(texto) ? texto : PERIODO_PADRAO;
}

/**
 * Quanto vale o fuso, em milissegundos, NAQUELE instante.
 *
 * "Naquele instante" não é preciosismo: o offset muda com o horário de verão.
 * O Brasil não tem mais desde 2019, mas este código não pode assumir isso —
 * a próxima oferta pode ser em outro país, e o erro seria de uma hora num dia
 * do ano, o tipo de coisa que ninguém encontra depois.
 */
function offsetMs(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const campo = (tipo: string): number =>
    Number(partes.find((p) => p.type === tipo)?.value ?? '0');

  const comoSeFosseUtc = Date.UTC(
    campo('year'),
    campo('month') - 1,
    campo('day'),
    // O `hour12: false` do Intl devolve 24 para a meia-noite em alguns
    // ambientes; o módulo normaliza sem mexer no resto.
    campo('hour') % 24,
    campo('minute'),
    campo('second'),
  );

  return comoSeFosseUtc - instante.getTime();
}

/** A data no fuso, como `[ano, mês, dia]` — o mês em base 1. */
function dataLocal(instante: Date, fuso: string): [number, number, number] {
  // `en-CA` formata como `2026-09-22`, que é ISO e não precisa de parsing.
  const [ano = '0', mes = '1', dia = '1'] = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(instante)
    .split('-');

  return [Number(ano), Number(mes), Number(dia)];
}

/**
 * A meia-noite daquele dia, no fuso, como instante UTC.
 *
 * Duas passadas de propósito. A primeira estima o offset usando a meia-noite
 * em UTC como palpite; a segunda corrige o caso em que o offset do palpite é
 * diferente do offset do instante que ele produziu — que é exatamente o que
 * acontece na virada do horário de verão.
 */
function meiaNoiteLocal(
  ano: number,
  mes: number,
  dia: number,
  fuso: string,
): Date {
  const palpite = Date.UTC(ano, mes - 1, dia);
  const primeiro = palpite - offsetMs(new Date(palpite), fuso);
  const segundo = palpite - offsetMs(new Date(primeiro), fuso);
  return new Date(segundo);
}

const UM_DIA = 86_400_000;

/**
 * Traduz o período em dois instantes.
 *
 * `agora` é parâmetro, e não `new Date()` lá dentro, porque isto tem de ser
 * testável: uma função que lê o relógio por dentro só se testa esperando.
 */
export function intervaloDe(
  periodo: Periodo,
  fuso: string,
  agora: Date = new Date(),
): Intervalo {
  const [ano, mes, dia] = dataLocal(agora, fuso);
  const hoje = meiaNoiteLocal(ano, mes, dia, fuso);
  const amanha = meiaNoiteLocal(ano, mes, dia + 1, fuso);

  /*
   * `Record<Periodo, …>` e não `switch`: o tipo obriga a ter as cinco chaves,
   * então acrescentar um período novo em `PERIODOS` sem tratá-lo aqui quebra
   * o build em vez de cair num `default` silencioso. As funções são
   * preguiçosas para só uma conta de fuso rodar.
   */
  const janelas: Record<Periodo, () => [Date, Date]> = {
    hoje: () => [hoje, amanha],
    ontem: () => [meiaNoiteLocal(ano, mes, dia - 1, fuso), hoje],
    // Sete dias INCLUINDO hoje: é o que a pessoa quer dizer com "últimos 7
    // dias". Seis dias atrás mais hoje dá sete.
    '7d': () => [meiaNoiteLocal(ano, mes, dia - 6, fuso), amanha],
    '30d': () => [meiaNoiteLocal(ano, mes, dia - 29, fuso), amanha],
    mes: () => [meiaNoiteLocal(ano, mes, 1, fuso), amanha],
  };

  const [de, ate] = janelas[periodo]();

  return {
    periodo,
    de,
    ate,
    fuso,
    // Arredondado porque a virada do horário de verão faz um dia ter 23 ou 25
    // horas, e `Math.round` acerta nos dois casos.
    dias: Math.max(1, Math.round((ate.getTime() - de.getTime()) / UM_DIA)),
  };
}

/**
 * O intervalo de igual duração imediatamente anterior — para o "vs período
 * anterior" dos cartões.
 *
 * Colado, sem sobreposição: o `de` do atual é o `ate` do anterior, e como
 * `ate` é exclusivo nenhum registro cai nos dois.
 */
export function intervaloAnterior(atual: Intervalo): Intervalo {
  const duracao = atual.ate.getTime() - atual.de.getTime();
  return {
    ...atual,
    de: new Date(atual.de.getTime() - duracao),
    ate: atual.de,
  };
}
