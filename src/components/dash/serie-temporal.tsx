'use client';

import * as React from 'react';

import { inteiro, moeda, moedaCurta } from '@/lib/formato';
import {
  ALTURA_DO_QUADRO,
  diaNaPosicao,
  montarGeometria,
  tetoComum,
  type CorDaSerie,
  type SerieDoQuadro,
} from '@/lib/painel/serie';
import { cn } from '@/lib/utils';

/**
 * Série temporal de uma ou duas métricas, no MESMO eixo.
 *
 * O SVG desenha só a área e as linhas, com `preserveAspectRatio="none"` para
 * esticar na largura disponível. Marcador e alvo de toque são HTML
 * posicionado em porcentagem — dentro do SVG esticado eles virariam elipses.
 * O `vector-effect` mantém a linha com 2px reais em qualquer largura.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ UM EIXO. NUNCA DOIS.                                                     │
 * │                                                                          │
 * │ Duas medidas em dois eixos é o erro nº 1 de gráfico: as escalas são      │
 * │ escolhidas por quem desenha, então o cruzamento das linhas e o vão entre │
 * │ elas passam a significar o que o autor quiser. Aqui as duas séries são a │
 * │ MESMA unidade (reais), o teto é compartilhado (`tetoComum`), e por isso  │
 * │ o vão entre as linhas é literalmente a margem sobre a mídia e o          │
 * │ cruzamento é literalmente o ponto de equilíbrio.                         │
 * │                                                                          │
 * │ Duas séries de unidades diferentes não entram aqui — entram em dois      │
 * │ quadros.                                                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Um componente para os dois casos, e não dois componentes, porque calha,
 * escala, faixa de toque, cruzeta e tooltip são idênticos: separados, o dia
 * em que o eixo mudasse mudaria num só.
 */

const L = 600;
const A = ALTURA_DO_QUADRO;

/** `2026-09-25` → `25/09`. Derivado do texto, sem passar por `Date`. */
function diaCurto(iso: string): string {
  const [, mes = '', dia = ''] = iso.split('-');
  return `${dia}/${mes}`;
}

/**
 * Como formatar, por NOME e não por função.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Função não atravessa a fronteira servidor→cliente. Passar `formatar` de │
 * │ um Server Component para cá dá "Functions cannot be passed directly to  │
 * │ Client Components" — e não é erro de build só: é a serialização do RSC  │
 * │ que não tem como mandar código.                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O nome viaja, o componente escolhe. `simbolo` vem junto porque a moeda é
 * do gateway, não nossa: a Pagou opera em MXN também.
 */
export type Formato = 'moeda' | 'inteiro';

/**
 * As cores, em classes ESCRITAS POR EXTENSO — e isso não é verbosidade.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `stroke-${cor}` NÃO GERA CSS.                                            │
 * │                                                                          │
 * │ O Tailwind varre o TEXTO do fonte para saber quais classes emitir; um    │
 * │ nome montado em tempo de execução ele não vê. A classe chega ao          │
 * │ navegador sem regra nenhuma, a linha fica sem cor — e como `stroke`      │
 * │ não tem valor padrão visível, ela simplesmente NÃO APARECE. Sem erro de  │
 * │ build, sem aviso no console: o quadro abre com uma série a menos.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Por que não `--success` na receita, como na árvore de geo: ele é token de
 * ESTADO, e a skill de dataviz reserva os de estado para estado. Medido, ele
 * reprova a banda de luminosidade no tema escuro (L 0,772 contra a faixa
 * 0,48–0,67) — numa barra grossa isso passa, numa linha de 2px ela some no
 * fundo claro. `--chart-2` é vizinho de matiz (a leitura "frio = receita"
 * continua) e passa os seis checks nos dois temas.
 */
const CORES: Record<
  CorDaSerie,
  { linha: string; area: string; marca: string }
> = {
  azul: { linha: 'stroke-chart-1', area: 'fill-chart-1/12', marca: 'bg-chart-1' },
  teal: { linha: 'stroke-chart-2', area: 'fill-chart-2/12', marca: 'bg-chart-2' },
  ambar: { linha: 'stroke-chart-3', area: 'fill-chart-3/12', marca: 'bg-chart-3' },
};

export function SerieTemporal({
  series,
  formato,
  simbolo = 'R$',
}: {
  /** Uma ou duas. Três linhas num quadro de 160px viram novelo. */
  series: SerieDoQuadro[];
  formato: Formato;
  simbolo?: string;
}) {
  /** O valor cheio, com centavos — tooltip e leitor de tela. */
  const formatar = (valor: number): string =>
    formato === 'moeda' ? moeda(valor, simbolo) : inteiro(valor);

  /*
   * O rótulo do EIXO é outro, e mais curto.
   *
   * A calha tem 56px: `R$ 4.000,00` não cabe e o navegador quebra a linha
   * entre o símbolo e o número — o "R$" sozinho em cima parece outro valor.
   * Foi a foto que pegou, no desktop, assim que a receita passou de mil.
   * Eixo dá ordem de grandeza; o centavo está no tooltip.
   */
  const formatarEixo = (valor: number): string =>
    formato === 'moeda' ? moedaCurta(valor, simbolo) : inteiro(valor);

  const [ativo, setAtivo] = React.useState<number | null>(null);
  const quadro = React.useRef<HTMLDivElement>(null);

  const comDado = series.filter((s) => s.pontos.length > 0);

  if (comDado.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Sem dado no período.
      </p>
    );
  }

  /*
   * O teto é de TODAS as séries juntas. Cada uma calculando o seu daria um
   * eixo duplo por dentro, sem parecer um: duas curvas cheias, cada uma
   * chegando ao topo do quadro, e o vão entre elas dizendo nada.
   */
  const teto = tetoComum(...comDado.map((s) => s.pontos));
  const desenhos = comDado.map((s) => ({
    id: s.id,
    rotulo: s.rotulo,
    cor: s.cor,
    g: montarGeometria(s.pontos, L, A, 4, teto),
  }));

  // A calha e as faixas de toque saem da PRIMEIRA série. As duas têm os
  // mesmos dias — é o que `alinharPorDia` garante —, e com o teto
  // compartilhado as marcas são idênticas.
  const base = desenhos[0];
  if (!base) return null;

  const indice = ativo ?? base.g.pontos.length - 1;
  const umaSo = desenhos.length === 1;

  /*
   * O DIA SOB O PONTEIRO, calculado da posição — e não de qual faixa
   * recebeu o evento.
   *
   * ┌─────────────────────────────────────────────────────────────────────┐
   * │ O TOOLTIP ESTAVA MORTO NO IPHONE, e nada dizia isso.                │
   * │                                                                     │
   * │ Ele nasceu com `onMouseEnter` + `onFocus` nas faixas. Nenhum dos    │
   * │ dois chega num toque: o Safari do iOS **não dá foco a `<button>`**  │
   * │ ao tocar (só campo de formulário), e o `mouseenter` sintético dele  │
   * │ é o caminho de dois toques que existe para menu de hover — num      │
   * │ alvo invisível de 8px ninguém acerta duas vezes. O gráfico abria    │
   * │ bonito e o número do dia era inalcançável no aparelho em que este   │
   * │ painel mais é aberto. Medido, com toque emulado: o dia não mudava   │
   * │ em toque nenhum.                                                    │
   * └─────────────────────────────────────────────────────────────────────┘
   *
   * Pointer Events resolve os três de uma vez (mouse, dedo e caneta), e
   * ler a POSIÇÃO em vez do alvo resolve um quarto: com 30 dias em 260px
   * cada faixa tem 8px, e arrastar o dedo pela série não funcionaria por
   * faixa nenhuma — o iOS prende o ponteiro ao elemento onde o toque
   * começou, então os `enter` dos vizinhos nunca chegariam.
   */
  const dias = base.g.pontos.length;
  function diaSobOPonteiro(clientX: number): number | null {
    const caixa = quadro.current?.getBoundingClientRect();
    if (!caixa || caixa.width === 0) return null;
    // A conta mora em `serie.ts`, com teste: é onde um erro de
    // arredondamento se esconderia mostrando o dia vizinho.
    return diaNaPosicao((clientX - caixa.left) / caixa.width, dias);
  }

  return (
    <div className="flex flex-col gap-2">
      {/*
        Legenda a partir de DUAS séries; com uma só, não — o título do cartão
        já diz o que está plotado, e uma caixinha com um quadrado repetiria o
        título gastando espaço.

        Sem o total do período ao lado do nome de propósito: ele já está no
        cartão de métrica acima, e dois desenhos do mesmo número lado a lado
        fazem quem olha conferir um contra o outro em vez de ler.
      */}
      {!umaSo && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {desenhos.map((s) => (
            <span
              key={s.id}
              className="text-muted-foreground flex items-center gap-1.5 text-xs"
            >
              <span
                className={cn('size-2.5 shrink-0 rounded-full', CORES[s.cor].marca)}
              />
              {s.rotulo}
            </span>
          ))}
        </div>
      )}

      {/*
        Calha e quadro como IRMÃOS num flex, não como camadas absolutas.
        Com o SVG posicionado por `left`/`right` ele não ganhava largura
        calculada e caía no tamanho intrínseco do `viewBox` — 600px — que no
        celular escapava do cartão e atravessava a tela. Aqui a largura vem
        do `flex-1`, e todo `%` é relativo só ao quadro.
      */}
      <div className="flex gap-2" style={{ height: `${String(A)}px` }}>
        <div className="relative w-14 shrink-0">
          {base.g.marcas.map((marca) => (
            <span
              key={`r${String(marca.valor)}`}
              /*
                `whitespace-nowrap` é cinto e suspensório: o formato curto já
                cabe, mas uma moeda de sigla longa (`PLN 1.125`) voltaria a
                quebrar — e quebrar aqui é silencioso, porque continua um
                número na tela, só que partido em dois.
              */
              className="text-muted-foreground tabular absolute right-0 -translate-y-1/2 text-right text-[10px] leading-tight whitespace-nowrap"
              style={{ top: `${String((marca.y / A) * 100)}%` }}
            >
              {formatarEixo(marca.valor)}
            </span>
          ))}
        </div>

        <div
          ref={quadro}
          className="relative min-w-0 flex-1"
          /*
            `pan-y pinch-zoom`: a rolagem VERTICAL da página continua sendo
            do navegador — o quadro ocupa a largura toda do celular, e quem
            começa a rolar com o dedo em cima dele não pode ficar preso. O
            `pinch-zoom` fica junto porque tirá-lo mataria o zoom de dois
            dedos, que no iOS é recurso de acessibilidade, não enfeite.
            O que sobra para nós é o movimento horizontal, que é o do
            gráfico.
          */
          style={{ touchAction: 'pan-y pinch-zoom' }}
          onPointerDown={(e) => {
            const i = diaSobOPonteiro(e.clientX);
            if (i !== null) setAtivo(i);
          }}
          onPointerMove={(e) => {
            // O mouse acompanha sempre; o dedo, só enquanto está encostado
            // (`buttons` é 1 durante o contato). Sem esta guarda, no
            // desktop o gráfico reagiria ao ponteiro parado passando por
            // cima — que é o certo — e no celular a nada, que é o de hoje.
            if (e.pointerType !== 'mouse' && e.buttons === 0) return;
            const i = diaSobOPonteiro(e.clientX);
            if (i !== null) setAtivo(i);
          }}
          onPointerLeave={(e) => {
            // Só o mouse "sai". No toque não existe sair, e voltar ao
            // último dia apagaria justamente o que a pessoa foi ver.
            if (e.pointerType === 'mouse') setAtivo(null);
          }}
        >
          {/* Grade: um passo de cinza acima do fundo, 1px, sólida. Nunca
              tracejada — tracejado é ruído que compete com o dado. */}
          {base.g.marcas.map((marca) => (
            <div
              key={marca.valor}
              className="border-border/40 absolute inset-x-0 border-t"
              style={{ top: `${String((marca.y / A) * 100)}%` }}
            />
          ))}

          <svg
            viewBox={`0 0 ${String(L)} ${String(A)}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            {/*
              Área só quando é UMA série.
              Duas lavagens a 12% se somam onde se cruzam e viram um terceiro
              tom — que lê como uma terceira categoria justamente no ponto de
              equilíbrio, que é o que o quadro existe para mostrar. Com duas,
              são duas linhas e o vão fica limpo.
            */}
            {umaSo && <path d={base.g.area} className={CORES[base.cor].area} />}
            {desenhos.map((s) => (
              <path
                key={s.id}
                d={s.g.linha}
                className={cn('fill-none', CORES[s.cor].linha)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* Faixas de toque: uma por dia, largura inteira da coluna. O
              alvo é maior que o marcador de propósito — ponto de 10px é
              impossível de acertar no dedo. Uma faixa por DIA e não por
              série: as duas linhas compartilham o dia, e alvos empilhados
              disputariam o mesmo clique. */}
          {base.g.pontos.map((ponto, i) => (
            <button
              key={ponto.dia}
              type="button"
              aria-label={`${diaCurto(ponto.dia)}: ${desenhos
                .map(
                  (s) =>
                    `${formatar(s.g.pontos[i]?.valor ?? 0)} ${s.rotulo}`,
                )
                .join(', ')}`}
              /*
                Sobram para TECLADO e leitor de tela: o `aria-label` acima é
                o que diz o dia e os valores para quem não vê o desenho, e o
                Tab continua andando de dia em dia. O ponteiro é do quadro.
              */
              onFocus={() => { setAtivo(i); }}
              className="absolute top-0 bottom-0"
              style={{
                left: `${String((ponto.x / L) * 100)}%`,
                width: `${String(100 / Math.max(1, base.g.pontos.length))}%`,
                transform: 'translateX(-50%)',
                // O quadro lê a posição; a faixa não precisa interceptar —
                // e interceptando ela ainda pisca o cinza de toque do iOS.
                pointerEvents: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            />
          ))}

          {/* Cruzeta e marcadores. O anel na cor do cartão é o que mantém o
              ponto legível onde ele cruza a linha — e com duas séries é ele
              que separa os dois marcadores quando elas se encontram. */}
          {base.g.pontos[indice] && (
            <div
              className="bg-border/70 pointer-events-none absolute top-0 bottom-0 w-px"
              style={{
                left: `${String((base.g.pontos[indice].x / L) * 100)}%`,
              }}
            />
          )}
          {desenhos.map((s) => {
            const p = s.g.pontos[indice];
            if (!p) return null;
            return (
              <div
                key={s.id}
                className={cn(
                  'ring-card pointer-events-none absolute size-2.5 rounded-full ring-2',
                  CORES[s.cor].marca,
                )}
                style={{
                  left: `${String((p.x / L) * 100)}%`,
                  top: `${String((p.y / A) * 100)}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* O tooltip mora FORA do quadro, numa linha fixa: dentro dele
          precisaria desviar das bordas, e numa faixa de 160px de altura
          taparia o próprio dado. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pl-16 text-xs">
        <span className="text-muted-foreground tabular">
          {diaCurto(base.g.pontos[0]?.dia ?? '')} —{' '}
          {diaCurto(base.g.pontos.at(-1)?.dia ?? '')}
        </span>
        <span
          className={cn(
            'flex flex-wrap items-baseline gap-x-3 gap-y-1',
            // Sem hover o que aparece é o último dia. Em cinza, porque é
            // valor padrão e não escolha de quem está olhando.
            ativo === null && 'text-muted-foreground',
          )}
        >
          <span className="tabular">
            {diaCurto(base.g.pontos[indice]?.dia ?? '')}
          </span>
          {desenhos.map((s) => (
            <span key={s.id} className="flex items-baseline gap-1.5 whitespace-nowrap">
              {/* O ponto colorido só com duas séries: com uma, a cor não
                  distingue nada e o rótulo já está no título. */}
              {!umaSo && (
                <span
                  className={cn(
                    'size-2 shrink-0 translate-y-[-1px] rounded-full',
                    CORES[s.cor].marca,
                  )}
                />
              )}
              <span className="text-foreground tabular font-medium">
                {formatar(s.g.pontos[indice]?.valor ?? 0)}
              </span>
              <span className="text-muted-foreground">{s.rotulo}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
