import { describe, expect, it } from 'vitest';

import { faixaDaReceita, estadosSemAlcance, pintarMapa } from './mapa';
import {
  ESTADOS_BRASIL,
  TOTAL_DE_ESTADOS,
  ufDaRegiao,
} from './mapa-brasil';
import { montarArvoreGeo, type LinhaGeoFina } from './geo-arvore';


/**
 * Lançamento de raio: o ponto está dentro de algum anel do contorno?
 *
 * Os contornos são `M x y L x y … Z`, polígonos puros sem curva — então o
 * teste clássico basta e não precisa de parser de SVG.
 */
function dentroDoPoligono(x: number, y: number, d: string): boolean {
  for (const trecho of d.split('M').slice(1)) {
    const nums = trecho.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const pontos: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pontos.push([nums[i] ?? 0, nums[i + 1] ?? 0]);
    }
    let dentro = false;
    for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
      const [xi, yi] = pontos[i] ?? [0, 0];
      const [xj, yj] = pontos[j] ?? [0, 0];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        dentro = !dentro;
      }
    }
    if (dentro) return true;
  }
  return false;
}

function linha(p: Partial<LinhaGeoFina> & { pais: string }): LinhaGeoFina {
  return {
    regiao: null,
    cidade: null,
    visitantes: 0,
    aprovadas: 0,
    receita: 0,
    ...p,
  };
}

/*
 * A JUNTA EM QUE O MAPA INTEIRO FICA CINZA SEM DAR ERRO.
 *
 * `geo_region` guarda o que o cabeçalho manda, em ISO 3166-2: `BR-SP`, não
 * `SP`. Casar contra a lista de estados sem tirar o prefixo não acha nada —
 * e o resultado não é uma exceção, é um mapa cinza inteiro, que lê
 * exatamente como "esta loja não vendeu para lugar nenhum".
 */
describe('ufDaRegiao', () => {
  it('tira o prefixo do país, que é o formato que o banco guarda', () => {
    expect(ufDaRegiao('BR-SP', 'BR')).toBe('SP');
    expect(ufDaRegiao('BR-MG', 'BR')).toBe('MG');
    expect(ufDaRegiao('BR-DF', 'BR')).toBe('DF');
  });

  it('aceita a sigla sozinha — o Cloudflare manda assim', () => {
    expect(ufDaRegiao('SP', 'BR')).toBe('SP');
    expect(ufDaRegiao('sp', 'BR')).toBe('SP');
    expect(ufDaRegiao(' rj ', 'BR')).toBe('RJ');
  });

  /*
   * AS SIGLAS QUE COLIDEM DE VERDADE — e este teste já nasceu errado uma vez.
   *
   * A primeira versão usava `US-CA` e `PT-11`, e passava mesmo com a
   * checagem do país REMOVIDA: `CA` e `11` não são estados brasileiros, então
   * a busca na lista já devolvia null e a asserção não provava nada. Achado
   * ao verificar quebrando — tirei a checagem e os 19 testes seguiram verdes.
   *
   * As colisões reais são seis, e todas são estados grandes dos dois lados:
   *
   *   US-PA  Pensilvânia   ↔  PA  Pará
   *   US-MA  Massachusetts ↔  MA  Maranhão
   *   US-SC  South Carolina↔  SC  Santa Catarina
   *   US-MS  Mississippi   ↔  MS  Mato Grosso do Sul
   *   US-MT  Montana       ↔  MT  Mato Grosso
   *   US-AL  Alabama       ↔  AL  Alagoas
   *
   * Sem a checagem, um visitante da Pensilvânia pinta o Pará — e não há
   * erro nenhum: só um estado do Norte que "vendeu" sem nunca ter vendido.
   */
  it('estado de OUTRO país não vira estado brasileiro', () => {
    for (const estrangeiro of ['US-PA', 'US-MA', 'US-SC', 'US-MS', 'US-MT', 'US-AL']) {
      expect(ufDaRegiao(estrangeiro, 'US'), estrangeiro).toBeNull();
    }
    expect(ufDaRegiao('US-CA', 'US')).toBeNull();
    expect(ufDaRegiao('PT-11', 'PT')).toBeNull();
  });

  /*
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ ESTE É O TESTE QUE FALTAVA, E O DE CIMA PASSAVA SEM ELE.                │
   * │                                                                        │
   * │ O de cima exercita `US-PA` — a forma COM prefixo. A Vercel manda a     │
   * │ sigla CRUA, e foi a tela real que mostrou: "Estados Unidos > OR".      │
   * │ Com `PA` cru e sem o país, a antiga `ufDaRegiao` devolvia `PA` e a     │
   * │ Pensilvânia virava Pará. A asserção certa, contra o dado errado.       │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  it('sigla CRUA de outro país — as seis colisões reais', () => {
    const colisoes = {
      PA: 'Pensilvânia / Pará',
      MA: 'Maine / Maranhão',
      SC: 'South Carolina / Santa Catarina',
      MS: 'Mississippi / Mato Grosso do Sul',
      MT: 'Montana / Mato Grosso',
      AL: 'Alabama / Alagoas',
    };

    for (const [sigla, par] of Object.entries(colisoes)) {
      // Dos Estados Unidos: não é estado deste mapa.
      expect(ufDaRegiao(sigla, 'US'), par).toBeNull();
      // Do Brasil, a MESMA sigla crua: é, e continua sendo.
      expect(ufDaRegiao(sigla, 'BR'), par).toBe(sigla);
    }
  });

  it('país ausente recusa, em vez de adivinhar', () => {
    // Sem país não há resposta certa para `PA`. Recusar é a única saída
    // honesta — e é o que impede um caminho novo de reabrir a colisão.
    expect(ufDaRegiao('PA', null)).toBeNull();
    expect(ufDaRegiao('PA', undefined)).toBeNull();
    expect(ufDaRegiao('PA', '')).toBeNull();
    // Mesmo com o prefixo explícito: quem manda é o país.
    expect(ufDaRegiao('BR-PA', null)).toBeNull();
  });

  it('sigla que não existe volta null, em vez de inventar', () => {
    expect(ufDaRegiao('BR-XX', 'BR')).toBeNull();
    expect(ufDaRegiao('ZZ', 'BR')).toBeNull();
    expect(ufDaRegiao('', 'BR')).toBeNull();
    expect(ufDaRegiao(null, 'BR')).toBeNull();
    expect(ufDaRegiao(undefined, 'BR')).toBeNull();
  });
});

describe('a geometria', () => {
  it('tem os 27 estados, e nenhum sem contorno', () => {
    // O arquivo é GERADO. Truncado pela metade, o mapa abriria com meio
    // Brasil e nada apontaria a falta.
    expect(ESTADOS_BRASIL).toHaveLength(TOTAL_DE_ESTADOS);
    for (const e of ESTADOS_BRASIL) {
      expect(e.d.startsWith('M'), e.uf).toBe(true);
      expect(e.d.length, e.uf).toBeGreaterThan(20);
      expect(e.uf, e.uf).toMatch(/^[A-Z]{2}$/);
      expect(e.nome.length, e.uf).toBeGreaterThan(2);
    }
  });

  /*
   * O centroide tem de cair DENTRO do estado, não só dentro da moldura.
   *
   * "Dentro da moldura" era a asserção da primeira versão, e ela passa com o
   * rótulo no meio do oceano — o Atlântico também está dentro da moldura.
   *
   * **E este teste é piso, não rede fina — medido.** Tentei quebrá-lo de
   * dois jeitos plausíveis (centroide pela média de TODOS os anéis, com as
   * ilhas puxando; e centro da CAIXA em vez do centroide) e ele passou nos
   * dois: os 27 estados brasileiros são convexos o bastante para os três
   * cálculos darem ponto interno. Ele pega corrupção grossa, que é o modo
   * de falha real de um arquivo GERADO; quem pega deslocamento fino é o
   * gabarito de caixas acima, e esse reprova 7 estados com o defeito real
   * que houve.
   *
   * `dentroDoPoligono` é lançamento de raio: conta quantas vezes uma
   * semirreta horizontal cruza a borda. Ímpar é dentro.
   */
  it('o centroide de cada estado cai DENTRO do estado', () => {
    for (const e of ESTADOS_BRASIL) {
      expect(dentroDoPoligono(e.cx, e.cy, e.d), e.uf).toBe(true);
    }
  });

  it('não há sigla repetida', () => {
    const siglas = new Set(ESTADOS_BRASIL.map((e) => e.uf));
    expect(siglas.size).toBe(TOTAL_DE_ESTADOS);
  });
});


/*
 * O GABARITO DA GEOMETRIA — onde cada estado COMEÇA e TERMINA.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ISTO EXISTE POR CAUSA DE UM DEFEITO QUE NÃO APARECIA NA TELA.            │
 * │                                                                          │
 * │ O gerador quebra o contorno em sub-caminhos (o continente e as ilhas).   │
 * │ A primeira versão zerava o ponto atual a cada sub-caminho — e no SVG o   │
 * │ `m` depois de um `z` é relativo AO PONTO ATUAL, que volta ao início do   │
 * │ sub-caminho anterior, não à origem. As ilhas iam parar longe do estado.  │
 * │                                                                          │
 * │ O mapa continuava PARECENDO certo: as ilhas têm poucos pixels e somem    │
 * │ no meio do oceano. O que mudava era o ALVO DE TOQUE — a caixa de São     │
 * │ Paulo passava a cobrir 70% do país, e tocar em SP selecionava Mato       │
 * │ Grosso. Descoberto testando o TOQUE, não olhando o desenho.              │
 * │                                                                          │
 * │ Os números abaixo foram conferidos contra o arquivo ORIGINAL desenhado   │
 * │ pelo navegador, estado por estado. Rodando a mesma verificação contra o  │
 * │ gerador defeituoso, 7 estados reprovam com erro de até 533 unidades.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const CAIXAS: Record<string, [number, number, number, number]> = {
  AC: [0.3, 192.8, 115.2, 255.9],
  AL: [558.5, 219.6, 606.4, 245.8],
  AM: [3.5, 47.6, 275.5, 235.4],
  AP: [300.4, 14.1, 376.6, 100.0],
  BA: [428.4, 215.0, 571.1, 371.3],
  CE: [508.6, 126.3, 574.1, 204.2],
  DF: [402.3, 325.3, 417.0, 334.1],
  ES: [501.9, 365.0, 536.2, 419.9],
  GO: [325.0, 277.0, 438.6, 390.3],
  MA: [394.4, 98.8, 502.6, 243.0],
  MG: [359.2, 305.3, 533.2, 446.6],
  MS: [247.6, 352.7, 360.5, 466.6],
  MT: [193.6, 196.2, 371.3, 366.3],
  PA: [234.9, 42.6, 436.0, 235.5],
  PB: [550.5, 175.6, 612.3, 211.0],
  PE: [509.6, 195.1, 611.9, 229.3],
  PI: [437.7, 125.0, 524.5, 252.1],
  PR: [303.1, 440.8, 404.8, 512.3],
  RJ: [455.1, 411.6, 516.0, 454.5],
  RN: [552.7, 157.1, 609.6, 190.7],
  RO: [112.2, 206.6, 221.1, 296.3],
  RR: [143.9, 0.3, 236.5, 104.2],
  RS: [256.2, 518.7, 379.6, 638.8],
  SC: [315.0, 500.2, 400.3, 558.3],
  SE: [558.4, 230.6, 587.1, 262.8],
  SP: [325.7, 395.8, 466.1, 488.2],
  TO: [363.3, 162.3, 441.1, 290.4],
};

describe('a geometria não saiu do lugar', () => {
  it('cada estado ocupa a MESMA caixa do arquivo original', () => {
    for (const estado of ESTADOS_BRASIL) {
      const esperado = CAIXAS[estado.uf];
      expect(esperado, estado.uf).toBeDefined();

      // O formato emitido é `M x y L x y … Z` — só números, então a caixa
      // sai de uma varredura simples, sem precisar de parser de SVG.
      const nums = estado.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      const caixa = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ];

      for (const [i, valor] of caixa.entries()) {
        // Tolerância de 1 unidade do viewBox: é o arredondamento de uma casa
        // do gerador, e nada mais.
        expect(
          Math.abs(valor - (esperado?.[i] ?? 0)),
          `${estado.uf}[${String(i)}]`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('faixaDaReceita', () => {
  it('receita ZERO é tráfego, não o primeiro degrau da rampa', () => {
    // O primeiro degrau afirma "vendeu pouco"; zero é "não vendeu". São
    // coisas diferentes e a legenda as separa.
    expect(faixaDaReceita(0, 1000)).toBe('trafego');
  });

  it('os quatro degraus saem da fração do MAIOR', () => {
    expect(faixaDaReceita(1000, 1000)).toBe('r4');
    expect(faixaDaReceita(800, 1000)).toBe('r4');
    expect(faixaDaReceita(600, 1000)).toBe('r3');
    expect(faixaDaReceita(400, 1000)).toBe('r2');
    expect(faixaDaReceita(100, 1000)).toBe('r1');
  });

  it('as fronteiras são ABERTAS: em cima do corte, cai na faixa de baixo', () => {
    // Escrito porque eu mesmo errei ao escrever este arquivo — esperei que
    // 25% caísse em `r2`. Fronteira é decisão, não acaso: em cima do corte
    // vale a faixa menor, nos três cortes igualmente.
    expect(faixaDaReceita(250, 1000)).toBe('r1');
    expect(faixaDaReceita(500, 1000)).toBe('r2');
    expect(faixaDaReceita(750, 1000)).toBe('r3');
    // E um fio acima já sobe.
    expect(faixaDaReceita(250.01, 1000)).toBe('r2');
  });

  it('sem maior nenhum não divide por zero', () => {
    expect(faixaDaReceita(0, 0)).toBe('trafego');
    expect(faixaDaReceita(50, 0)).toBe('trafego');
  });
});

describe('pintarMapa', () => {
  const arvore = montarArvoreGeo([
    linha({ pais: 'BR', regiao: 'BR-SP', cidade: 'São Paulo', visitantes: 400, aprovadas: 12, receita: 4000 }),
    linha({ pais: 'BR', regiao: 'BR-MG', cidade: 'Belo Horizonte', visitantes: 200, aprovadas: 3, receita: 1000 }),
    // Visitou e não comprou — o estado que o mapa precisa distinguir.
    linha({ pais: 'BR', regiao: 'BR-BA', cidade: 'Salvador', visitantes: 90, aprovadas: 0, receita: 0 }),
    // Sem região: existe na árvore como "Não informado" e não tem onde ser
    // pintado. Não pode virar estado nenhum.
    linha({ pais: 'BR', regiao: null, cidade: null, visitantes: 50, aprovadas: 1, receita: 300 }),
    // Outro país: a árvore lista, o mapa do Brasil ignora.
    linha({ pais: 'PT', regiao: 'PT-11', cidade: 'Lisboa', visitantes: 30, aprovadas: 2, receita: 900 }),
  ]);

  const mapa = pintarMapa(arvore);
  const uf = (sigla: string) => mapa.find((e) => e.uf === sigla);

  it('devolve SEMPRE os 27 — inclusive os que não aparecem na árvore', () => {
    // É o ponto do mapa: a árvore só lista quem apareceu, e o estado de onde
    // nunca veio ninguém não tem linha lá. Aqui ele tem cor.
    expect(mapa).toHaveLength(TOTAL_DE_ESTADOS);
  });

  it('separa "não veio ninguém" de "veio e não comprou"', () => {
    expect(uf('AC')?.faixa).toBe('vazio');
    expect(uf('BA')?.faixa).toBe('trafego');
    // Os dois têm receita zero. Pintados iguais, o mapa diria que o estado
    // que você nunca alcançou e o estado onde sua oferta não converte são o
    // mesmo problema — e eles pedem ações opostas.
    expect(uf('BA')?.receita).toBe(0);
    expect(uf('AC')?.receita).toBe(0);
    expect(uf('BA')?.faixa).not.toBe(uf('AC')?.faixa);
  });

  it('o maior estado fica no topo da rampa', () => {
    expect(uf('SP')?.faixa).toBe('r4');
    expect(uf('SP')?.receita).toBe(4000);
    // 1000 de 4000 é exatamente 25% — em cima do corte, cai na faixa de baixo.
    expect(uf('MG')?.faixa).toBe('r1');
  });

  it('região SEM estado não é pintada em lugar nenhum', () => {
    // "Não informado" continua na árvore com nome — some do mapa porque não
    // tem onde cair, e não pode ser somado a um estado qualquer.
    const somaDoMapa = mapa.reduce((t, e) => t + e.receita, 0);
    expect(somaDoMapa).toBe(5000); // 4000 + 1000, sem os 300 sem região
  });

  it('país estrangeiro não entra', () => {
    const somaDeGente = mapa.reduce((t, e) => t + e.visitantes, 0);
    // 400 + 200 + 90 — sem os 50 sem região e sem os 30 de Portugal.
    expect(somaDeGente).toBe(690);
  });

  it('não discorda da árvore: cada estado leva o número do nó dele', () => {
    // O mapa e a árvore dividem o mesmo cartão. Se divergirem, a
    // discordância aparece a meio metro de distância — é o pior defeito
    // possível aqui, e o que impede é a origem ser a MESMA árvore.
    const brasil = arvore.find((r) => r.chave === 'BR');
    for (const no of brasil?.filhos ?? []) {
      const sigla = ufDaRegiao(no.chave, 'BR');
      if (!sigla) continue;
      expect(uf(sigla)?.receita, sigla).toBe(no.receita);
      expect(uf(sigla)?.visitantes, sigla).toBe(no.visitantes);
      expect(uf(sigla)?.aprovadas, sigla).toBe(no.aprovadas);
    }
  });

  it('conta quantos estados não receberam ninguém', () => {
    // 27 menos SP, MG e BA.
    expect(estadosSemAlcance(mapa)).toBe(24);
  });

  it('sem Brasil nenhum, os 27 vêm vazios em vez de estourar', () => {
    const soPortugal = montarArvoreGeo([
      linha({ pais: 'PT', regiao: 'PT-11', visitantes: 10, receita: 100 }),
    ]);
    const vazio = pintarMapa(soPortugal);
    expect(vazio).toHaveLength(TOTAL_DE_ESTADOS);
    expect(estadosSemAlcance(vazio)).toBe(TOTAL_DE_ESTADOS);
  });
});

/*
 * QUANDO O MAPA APARECE — a regra que eu errei e que custou meia hora.
 *
 * A primeira versão escondia o mapa sempre que não havia Brasil no período,
 * e isso engolia o caso mais comum: PERÍODO VAZIO. Num dia sem visitante o
 * mapa sumia inteiro, sem uma linha dizendo por quê — e quem abriu o painel
 * concluiu, com razão, que a função não tinha subido.
 *
 * A decisão mora na página, então o que dá para travar aqui é a condição.
 * Ela é simples o bastante para caber num teste e importante o bastante
 * para merecer um: esconder coisa da tela é a última escolha, nunca a
 * primeira.
 */
function mostrarMapa(raizes: { chave: string }[]): boolean {
  return raizes.length === 0 || raizes.some((r) => r.chave === 'BR');
}

describe('quando o mapa aparece', () => {
  it('período VAZIO mostra o mapa, vazio — não o esconde', () => {
    // O que o usuário viu: nada. O certo é um mapa cinza dizendo
    // "nenhum visitante com geo no período".
    expect(mostrarMapa([])).toBe(true);
  });

  it('com Brasil, aparece', () => {
    expect(mostrarMapa([{ chave: 'BR' }])).toBe(true);
    expect(mostrarMapa([{ chave: 'PT' }, { chave: 'BR' }])).toBe(true);
  });

  it('com geo e NENHUM brasileiro, aí sim some', () => {
    // Este é o caso que a regra original queria proteger, e ele continua
    // protegido: a loja vende só para fora, e um mapa do Brasil ao lado
    // não diria nada sobre o funil dela. A árvore lista os países.
    expect(mostrarMapa([{ chave: 'PT' }])).toBe(false);
    expect(mostrarMapa([{ chave: 'US' }, { chave: 'PT' }])).toBe(false);
  });
});
