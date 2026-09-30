import { CornerDownRight } from 'lucide-react';

import { inteiro, percentual } from '@/lib/formato';
import { faixasDoFunil, type Funil } from '@/lib/painel/funil';

/**
 * O funil, com forma de funil.
 *
 * **Uma cor só, de propósito — e o gradiente não quebra essa regra.** As
 * etapas não são identidades diferentes: são a mesma quantidade encolhendo.
 * Cor categórica aqui sugeriria que são coisas distintas e gastaria quatro
 * matizes para não dizer nada, porque quem carrega a magnitude é a LARGURA.
 * Série única também não pede legenda; o rótulo está ao lado.
 *
 * O gradiente vive DENTRO do mesmo matiz e atravessa o funil inteiro, de uma
 * ponta à outra — não é uma cor por degrau. Ver `ID_GRADIENTE` abaixo.
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

/**
 * O id do gradiente no documento.
 *
 * Fixo, e não gerado por render: o funil aparece UMA vez por tela (a visão
 * geral), e um `useId` aqui obrigaria o componente a virar cliente só para
 * isso. Se um dia houver dois funis na mesma página, este é o lugar de
 * trocar por `useId` — dois `<defs>` com o mesmo id fazem o segundo funil
 * herdar o gradiente do primeiro, e nada quebra: só fica igual.
 */
const ID_GRADIENTE = 'funil-rampa';

export function FunilEtapas({ funil }: { funil: Funil }) {
  const n = funil.etapas.length;

  /*
   * A geometria mora em `funil.ts`, com teste. Ela estava aqui e tinha um
   * defeito que só a foto pegou: o piso de largura era aplicado à etapa com
   * total ZERO, e "Comprou 0" virava uma barra sólida — compra fantasma
   * desenhada numa conta que não vendeu nada.
   */
  const faixas = faixasDoFunil(funil.etapas);

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
          <defs>
            {/*
              ┌───────────────────────────────────────────────────────────┐
              │ `userSpaceOnUse` NÃO É DETALHE — É O QUE FAZ SER UM       │
              │ GRADIENTE SÓ.                                             │
              │                                                           │
              │ O padrão do SVG é `objectBoundingBox`: cada polígono      │
              │ ganharia o gradiente INTEIRO dentro da própria caixa, e   │
              │ as quatro faixas sairiam repetindo a mesma rampa — quatro │
              │ listras com emenda visível em cada fronteira, que é       │
              │ exatamente "uma cor por etapa" entrando pela porta dos    │
              │ fundos. Com `userSpaceOnUse` e y de 0 a 100, a rampa      │
              │ pertence ao viewBox e o funil recebe UMA passagem só.     │
              └───────────────────────────────────────────────────────────┘
            */}
            <linearGradient
              id={ID_GRADIENTE}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="0"
              y2="100"
              // A cor mora AQUI e os stops a herdam por `currentColor`. Um
              // token do tema atravessa assim sem o componente saber qual é
              // — e continua certo nos dois temas de graça.
              className="text-chart-1"
            >
              {/*
                Do mais suave no topo ao CHEIO embaixo, e a escolha tem
                motivo. O contrário — cheio em cima, apagado embaixo —
                acompanharia a quantidade, mas deixaria a ponta de "Comprou"
                ao mesmo tempo a MENOR e a mais fraca do desenho: a etapa
                pela qual este painel existe sumindo no fundo. Aqui a
                intensidade não afirma quantidade (quem faz isso é a
                largura, e ela continua fazendo): ela marca a profundidade
                no funil, e o peso visual fica onde está o dinheiro.
              */}
              {/*
                A transparência vai em `stopOpacity`, NUNCA no alfa do
                `stopColor`. Pela especificação o canal alfa de um
                `stop-color` é ignorado, e as engines discordam na prática —
                o WebKit ignora. Escrito como `text-chart-1/55`, isto
                renderizaria certo no Chromium do meu teste e saía o
                gradiente inteiro chapado no Safari do iPhone, sem erro
                nenhum. É a armadilha do `input type=date` por outra porta:
                o navegador de quem olha é que decide.
              */}
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.55} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={1} />
            </linearGradient>
          </defs>

          {funil.etapas.map((etapa, i) => {
            const { topo: cima, baixo } = faixas[i] ?? { topo: 0, baixo: 0 };

            /*
             * Nada a desenhar. Acontece na etapa que mediu ZERO: a forma
             * fecha num ponto na etapa anterior e daqui para baixo não há
             * corpo nenhum. Um polígono de largura zero seria invisível de
             * todo modo, mas deixá-lo fora diz no código o que a tela mostra.
             */
            if (cima === 0 && baixo === 0) return null;

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
                    : undefined
                }
                /*
                  A etapa SEM DADO fica fora do gradiente de propósito: ela
                  não é um degrau mais claro do funil, é ausência de medida,
                  e continua com o tracejado que a separa das outras.
                */
                fill={etapa.desconhecido ? undefined : `url(#${ID_GRADIENTE})`}
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

      {funil.eventosFaltando.length > 0 && (
        <p className="text-warning text-xs">
          {funil.eventosFaltando.length === 1
            ? 'Um degrau do funil está vazio porque o dado não existe'
            : 'Dois degraus do funil estão vazios porque o dado não existe'}{' '}
          — não porque ninguém passou por lá. Confira se o snippet dispara{' '}
          {funil.eventosFaltando.map((nome, i) => (
            <span key={nome}>
              {i > 0 && ' e '}
              <code>{nome}</code>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}
