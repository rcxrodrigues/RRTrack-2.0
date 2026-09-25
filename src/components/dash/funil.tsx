import { CornerDownRight } from 'lucide-react';

import { inteiro, percentual } from '@/lib/formato';
import type { Etapa, Funil } from '@/lib/painel/funil';

/**
 * O funil, com forma de funil.
 *
 * **Uma cor só, de propósito.** As três etapas não são identidades
 * diferentes — são a mesma quantidade encolhendo. Cor categórica aqui
 * sugeriria que as etapas são coisas distintas e ainda gastaria três matizes
 * para não dizer nada: o que carrega a magnitude é a LARGURA. Série única
 * também não pede legenda; o rótulo está ao lado.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS COISAS QUE A PRIMEIRA VERSÃO ERROU, E A FOTO PEGOU:                 │
 * │                                                                          │
 * │ 1. Uma faixa por SVG, cada uma esticada na largura do cartão. Com        │
 * │    1150px de largura por 56px de altura, cair de 100% para 8% virava     │
 * │    uma SETA, não um funil — a forma gritava mais que o dado.             │
 * │ 2. O texto "8,1% seguiram" ficava ENTRE as faixas e abria um vão: as     │
 * │    três liam como formas soltas, e funil é uma coisa só, contínua.       │
 * │ 3. Piso de largura em 3%: a última etapa virava um fio invisível,        │
 * │    justamente a que mais interessa.                                      │
 * │                                                                          │
 * │ Agora é UM SVG, mais alto que largo, com as faixas encostadas. O texto   │
 * │ vai para a calha ao lado.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * **O piso de largura distorce, e por isso o número fica colado.** Uma etapa
 * de 1% desenhada com 1% de largura desaparece; desenhada com 10% mente
 * sobre a proporção. A saída é desenhar com piso E pôr o número e o
 * percentual na calha, onde a proporção exata está escrita. A forma diz
 * "afunila"; quem diz "quanto" é o número.
 */

/** Piso visível: abaixo disso a faixa some e "quase ninguém" vira "ninguém". */
const PISO = 9;

function larguraDe(etapa: Etapa, topo: number): number {
  if (etapa.desconhecido || topo <= 0 || etapa.total === 0) return 0;
  return Math.max(PISO, Math.min(100, (etapa.total / topo) * 100));
}

export function FunilEtapas({ funil }: { funil: Funil }) {
  const topo = funil.etapas[0]?.total ?? 0;
  const n = funil.etapas.length;

  const larguras = funil.etapas.map((e) => larguraDe(e, topo));

  /*
   * A etapa desconhecida não tem largura própria. A forma interpola entre os
   * vizinhos só para o funil não abrir um buraco; quem diz que ali não há
   * medida é o tracejado e o travessão na calha, não a geometria.
   */
  const efetiva = larguras.map((l, i) => {
    if (l > 0) return l;
    if (!funil.etapas[i]?.desconhecido) return PISO;
    const antes = larguras[i - 1] ?? 100;
    const depois = larguras.slice(i + 1).find((x) => x > 0) ?? PISO;
    return (antes + depois) / 2;
  });

  const alturaDaFaixa = 100 / n;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-stretch gap-4">
        {/*
          Mais alto que largo, e com largura fixa: é isso que faz o
          estreitamento parecer funil em vez de seta. `preserveAspectRatio`
          none deixa a forma esticar na caixa, e a caixa é que manda.
        */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-52 w-24 shrink-0 sm:w-32"
          role="img"
          aria-label="Funil de conversão"
        >
          {funil.etapas.map((etapa, i) => {
            const cima = efetiva[i] ?? PISO;
            const baixo = efetiva[i + 1] ?? cima;
            const y1 = i * alturaDaFaixa;
            const y2 = (i + 1) * alturaDaFaixa;
            const pts = [
              [50 - cima / 2, y1],
              [50 + cima / 2, y1],
              [50 + baixo / 2, y2],
              [50 - baixo / 2, y2],
            ]
              .map(([x, y]) => `${String(x)},${String(y)}`)
              .join(' ');

            return (
              <polygon
                key={etapa.rotulo}
                points={pts}
                className={
                  etapa.desconhecido
                    ? 'fill-muted/20 stroke-muted-foreground/50'
                    : 'fill-chart-1'
                }
                strokeWidth={etapa.desconhecido ? 1 : 0}
                strokeDasharray={etapa.desconhecido ? '3 3' : undefined}
                // Sem isto o traço estica junto com o SVG e vira risco
                // irregular — o desenho fica com cara de defeito.
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* A calha: rótulo, número, fração do topo e a perda para a seguinte. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {funil.etapas.map((etapa, i) => (
            <div
              key={etapa.rotulo}
              className="flex min-w-0 flex-1 flex-col justify-center"
            >
              <span className="truncate text-sm font-medium">{etapa.rotulo}</span>
              <span className="flex items-baseline gap-2">
                <span
                  data-slot="metric"
                  className={
                    etapa.desconhecido
                      ? 'text-muted-foreground/40 text-lg font-semibold tracking-tight'
                      : 'text-lg font-semibold tracking-tight'
                  }
                >
                  {/* Sem dado é travessão, nunca zero: é o que impede o painel
                      de afirmar que ninguém chegou ao checkout quando o
                      EVENTO é que não chegou. */}
                  {etapa.desconhecido ? '—' : inteiro(etapa.total)}
                </span>
                <span className="text-muted-foreground tabular text-xs">
                  {etapa.doTopo === null ? '—' : percentual(etapa.doTopo)}
                </span>
              </span>

              {/*
                A seta VIRA, não desce. Uma seta para baixo ao lado de "11,8%"
                lê-se como "caiu 11,8%" — e o número é o contrário disso: é o
                que PASSOU para a etapa seguinte.
              */}
              {i < funil.etapas.length - 1 && (
                <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                  <CornerDownRight className="size-3 shrink-0" aria-hidden />
                  {funil.etapas[i + 1]?.daAnterior == null ? (
                    <span className="truncate">sem base para comparar</span>
                  ) : (
                    <span className="truncate">
                      <span className="tabular">
                        {percentual(funil.etapas[i + 1]?.daAnterior ?? 0)}
                      </span>{' '}
                      seguiram
                    </span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {funil.semEventoDeCheckout && (
        <p className="text-warning text-xs">
          Nenhum evento de checkout chegou neste período. O meio do funil está
          vazio porque o dado não existe — não porque ninguém passou por lá.
          Confira se o snippet dispara <code>InitiateCheckout</code>.
        </p>
      )}
    </div>
  );
}
