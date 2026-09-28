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

const UM_DIA = 86_400_000;

export const PERIODOS = ['hoje', 'ontem', '7d', '30d', 'mes'] as const;

export type Periodo = (typeof PERIODOS)[number];

export const ROTULOS: Record<Periodo, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7d': '7 dias',
  '30d': '30 dias',
  mes: 'Este mês',
};

/**
 * Uma faixa escolhida à mão, em datas CIVIS e INCLUSIVAS nas duas pontas.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Inclusiva aqui, exclusiva lá dentro — e a tradução é o ponto.            │
 * │                                                                          │
 * │ Quem escolhe "1 a 15 de setembro" quer o dia 15 INTEIRO. O `Intervalo`   │
 * │ do painel tem fim exclusivo, porque com limite inclusivo o último        │
 * │ milissegundo do dia entraria em dois períodos ao mesmo tempo. Então a    │
 * │ faixa guarda o que a pessoa disse, e `intervaloDe` converte: `ate`       │
 * │ vira a meia-noite do dia 16.                                            │
 * │                                                                          │
 * │ Guardar já convertido faria a tela mostrar "1 a 16" de volta para quem   │
 * │ pediu "1 a 15", e a caixa de data viria com o dia errado.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Texto `YYYY-MM-DD`, não `Date`: é o que o `<input type="date">` manda e o
 * que a URL carrega. Passar por `Date` aqui reintroduziria o fuso no lugar
 * onde ele não pertence — "1º de setembro" é um dia do calendário, não um
 * instante.
 */
export type Faixa = { de: string; ate: string };

/** O que o filtro pode estar mostrando: um dos atalhos, ou uma faixa. */
export type Escolha = Periodo | Faixa;

export function ehFaixa(escolha: Escolha): escolha is Faixa {
  return typeof escolha !== 'string';
}

/**
 * Ao ABRIR o painel, o dia de hoje.
 *
 * Quem abre o painel quer saber como está hoje — "sete dias" é relatório, e
 * relatório se pede. Escolher um período diferente vale para a navegação
 * toda (ver `comPeriodo`), então a escolha não se perde ao trocar de aba;
 * o que não acontece é ela persistir depois de fechar.
 */
export const PERIODO_PADRAO: Periodo = 'hoje';

/**
 * O teto da faixa, em dias.
 *
 * Um ano é a comparação mais longa que alguém faz de verdade, e passar disso
 * quebra coisa de fora: a API da Meta recusa `time_range` além de 37 meses, e
 * o "vs período anterior" de uma faixa de cinco anos compara com cinco anos
 * que talvez nem existam. Faixa maior que isto cai no padrão, como qualquer
 * outro lixo de query string.
 */
export const MAXIMO_DE_DIAS = 366;

export type Intervalo = {
  escolha: Escolha;
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

/** O parâmetro pode chegar repetido na URL; vale o primeiro. */
function umValor(
  valor: string | string[] | null | undefined,
): string | undefined {
  return Array.isArray(valor) ? valor[0] : (valor ?? undefined);
}

/**
 * `YYYY-MM-DD` que existe no calendário.
 *
 * A ida e volta é o que pega `2026-02-31`: o `Date.UTC` aceita e rola para 3
 * de março, então comparar o texto de volta reprova. Sem isso, a faixa
 * aceitaria um dia inexistente e o painel mostraria um intervalo que ninguém
 * pediu, sem erro nenhum.
 */
function ehDataCivil(texto: string | undefined): texto is string {
  if (texto === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;

  const [ano = 0, mes = 0, dia = 0] = texto.split('-').map(Number);
  const instante = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    instante.getUTCFullYear() === ano &&
    instante.getUTCMonth() === mes - 1 &&
    instante.getUTCDate() === dia
  );
}

/** Quantos dias a faixa cobre, contando as duas pontas. */
function diasDaFaixa(faixa: Faixa): number {
  const emDias = (t: string): number => {
    const [a = 0, m = 0, d = 0] = t.split('-').map(Number);
    return Date.UTC(a, m - 1, d) / UM_DIA;
  };
  return emDias(faixa.ate) - emDias(faixa.de) + 1;
}

/**
 * O que veio na URL, ou o padrão. Nunca lança: query string é sugestão.
 *
 * Lê o objeto inteiro de parâmetros, e não um valor só, porque a faixa chega
 * em DOIS (`?de=…&ate=…`). São dois, e não um `?periodo=de..ate`, por causa
 * do formulário: `<input type="date">` num `<form method="get">` manda o
 * nome do campo, e é assim que o seletor funciona sem uma linha de
 * JavaScript — do mesmo jeito que os cinco atalhos, que são `<Link>`.
 *
 * A faixa ganha do atalho quando os dois vêm: quem acabou de submeter o
 * formulário mandou junto o `periodo` que estava na tela, e ignorar a faixa
 * ali faria o botão não fazer nada.
 */
export function lerEscolha(
  params: Record<string, string | string[] | null | undefined>,
): Escolha {
  const de = umValor(params.de);
  const ate = umValor(params.ate);

  if (ehDataCivil(de) && ehDataCivil(ate) && de <= ate) {
    // Comparação de texto basta: `YYYY-MM-DD` ordena igual à data.
    const faixa = { de, ate };
    if (diasDaFaixa(faixa) <= MAXIMO_DE_DIAS) return faixa;
  }

  const periodo = umValor(params.periodo);
  return ehPeriodo(periodo) ? periodo : PERIODO_PADRAO;
}

/**
 * A escolha lida de uma `URLSearchParams` — o que os componentes cliente têm.
 *
 * Existe para a sidebar e a barra do celular não remontarem a leitura à mão:
 * eram elas que só olhavam `periodo`, e uma faixa escolhida se perderia na
 * primeira troca de aba — calada, que é o modo de falha que `comPeriodo`
 * existe para evitar.
 */
export function escolhaDaQuery(query: URLSearchParams): Escolha {
  return lerEscolha({
    periodo: query.get('periodo'),
    de: query.get('de'),
    ate: query.get('ate'),
  });
}

/**
 * A escolha como parâmetros de URL.
 *
 * Fonte única para os três lugares que precisam remontar a query — o menu, a
 * paginação da aba de Eventos e os campos escondidos dos formulários. Cada um
 * montando o seu seria garantir que um dia a faixa deixa de atravessar de um
 * deles, em silêncio.
 */
export function paramsDaEscolha(escolha: Escolha): Record<string, string> {
  return ehFaixa(escolha)
    ? { de: escolha.de, ate: escolha.ate }
    : { periodo: escolha };
}

// À mão, sem `toLocaleDateString`: o ICU do Node não é o do navegador, e a
// diferença quebra a hidratação. É a mesma regra de `formato.ts`.
const curto = (dia: string, mes: string): string => `${dia}/${mes}`;
const comAno = (dia: string, mes: string, ano: string): string =>
  `${dia}/${mes}/${ano.slice(2)}`;

/** `01/09 – 15/09`, ou com o ano quando a faixa atravessa dezembro. */
export function rotuloDaEscolha(escolha: Escolha): string {
  if (!ehFaixa(escolha)) return ROTULOS[escolha];

  const [anoDe = '', mesDe = '', diaDe = ''] = escolha.de.split('-');
  const [anoAte = '', mesAte = '', diaAte = ''] = escolha.ate.split('-');

  return anoDe === anoAte
    ? `${curto(diaDe, mesDe)} – ${curto(diaAte, mesAte)}`
    : `${comAno(diaDe, mesDe, anoDe)} – ${comAno(diaAte, mesAte, anoAte)}`;
}

/**
 * O href de navegação carregando o período escolhido.
 *
 * O período vive na URL, e é isso que o torna compartilhável e à prova de
 * recarregar. Mas link de menu é caminho puro (`/eventos`), então trocar de
 * aba jogava a escolha fora e a tela voltava ao padrão — quem estava
 * olhando 30 dias no faturamento chegava à visão geral vendo hoje, sem
 * nada na tela dizendo que mudou.
 *
 * O padrão é omitido de propósito: URL sem query é o estado inicial, e
 * carregar `?periodo=hoje` só faria o link parecer sujo sem mudar nada.
 */
export function comPeriodo(href: string, escolha: Escolha): string {
  if (!ehFaixa(escolha) && escolha === PERIODO_PADRAO) return href;
  return `${href}?${new URLSearchParams(paramsDaEscolha(escolha)).toString()}`;
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

/**
 * Traduz o período em dois instantes.
 *
 * `agora` é parâmetro, e não `new Date()` lá dentro, porque isto tem de ser
 * testável: uma função que lê o relógio por dentro só se testa esperando.
 */
export function intervaloDe(
  escolha: Escolha,
  fuso: string,
  agora: Date = new Date(),
): Intervalo {
  /*
   * A faixa não olha o relógio: ela já traz os dois dias. O que ela precisa
   * do fuso é só a meia-noite — e o `+ 1` no fim é a conversão de inclusivo
   * (o que a pessoa escolheu) para exclusivo (o que o resto do painel usa).
   */
  if (ehFaixa(escolha)) {
    const [aDe = 0, mDe = 0, dDe = 0] = escolha.de.split('-').map(Number);
    const [aAte = 0, mAte = 0, dAte = 0] = escolha.ate.split('-').map(Number);

    const de = meiaNoiteLocal(aDe, mDe, dDe, fuso);
    const ate = meiaNoiteLocal(aAte, mAte, dAte + 1, fuso);

    return {
      escolha,
      de,
      ate,
      fuso,
      dias: Math.max(1, Math.round((ate.getTime() - de.getTime()) / UM_DIA)),
    };
  }

  const periodo = escolha;
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
    escolha: periodo,
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
