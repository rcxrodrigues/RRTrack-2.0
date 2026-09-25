import { CornerDownRight } from 'lucide-react';

import { inteiro, percentual } from '@/lib/formato';
import type { Funil } from '@/lib/painel/funil';

/**
 * O funil, em três barras horizontais.
 *
 * **Uma cor só, de propósito.** As três etapas não são identidades
 * diferentes — são a mesma quantidade encolhendo. Cor categórica aqui
 * sugeriria que as etapas são coisas distintas e ainda gastaria três matizes
 * para não dizer nada: o que carrega a magnitude é o COMPRIMENTO da barra.
 * Uma série só também não pede legenda; o rótulo já está na barra.
 *
 * Barras horizontais e não verticais porque os rótulos são frases ("Chegou
 * no checkout") — na vertical eles viram texto girado ou reticências.
 */
export function FunilEtapas({ funil }: { funil: Funil }) {
  const topo = funil.etapas[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-1">
      {funil.etapas.map((etapa, i) => {
        // Largura pela fração do topo, com um piso visível: uma barra de
        // 0,3% seria invisível, e "quase ninguém" é diferente de "ninguém".
        const fracao = topo > 0 ? Math.min(1, etapa.total / topo) : 0;
        const largura =
          etapa.desconhecido || etapa.total === 0
            ? 0
            : Math.max(1.5, fracao * 100);

        return (
          <div key={etapa.rotulo} className="flex flex-col gap-1">
            {/* A perda entre etapas fica ENTRE as barras, que é onde a
                pergunta aparece: "onde eu perdi essa gente?" */}
            {/*
              A seta VIRA, não desce. Uma seta para baixo ao lado de "10,6%"
              lê-se como "caiu 10,6%" — e o número é o contrário disso: é o
              que PASSOU. A `↳` diz "seguiu para cá", que é o que o número é.
            */}
            {i > 0 && (
              <div className="text-muted-foreground flex items-center gap-1 pl-1 text-xs">
                <CornerDownRight className="size-3 shrink-0" aria-hidden />
                {etapa.daAnterior === null ? (
                  <span>sem base para comparar com a etapa anterior</span>
                ) : (
                  <>
                    <span className="tabular">{percentual(etapa.daAnterior)}</span>
                    <span>seguiram da etapa anterior</span>
                  </>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{etapa.rotulo}</span>
                <span className="flex items-baseline gap-2">
                  <span
                    data-slot="metric"
                    className={
                      etapa.desconhecido
                        ? 'text-muted-foreground/40 text-base font-semibold tracking-tight'
                        : 'text-base font-semibold tracking-tight'
                    }
                  >
                    {/* Sem dado é travessão, nunca zero — a regra do projeto,
                        e aqui ela é o que impede o painel de afirmar que
                        ninguém chegou ao checkout quando o evento é que não
                        chegou. */}
                    {etapa.desconhecido ? '—' : inteiro(etapa.total)}
                  </span>
                  <span className="text-muted-foreground tabular text-xs">
                    {etapa.doTopo === null ? '—' : percentual(etapa.doTopo)}
                  </span>
                </span>
              </div>

              {/* Trilha + preenchimento. A ponta da direita é arredondada (é
                  onde o dado termina) e a da esquerda é reta, ancorada na
                  linha de base — é de lá que toda barra cresce. */}
              <div
                className="bg-muted/50 h-3 w-full overflow-hidden rounded-sm"
                role="img"
                aria-label={`${etapa.rotulo}: ${
                  etapa.desconhecido ? 'sem dado' : inteiro(etapa.total)
                }`}
              >
                <div
                  className="bg-chart-1 h-full rounded-r-[4px]"
                  style={{ width: `${String(largura)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {funil.semEventoDeCheckout && (
        <p className="text-warning mt-2 text-xs">
          Nenhum evento de checkout chegou neste período. O meio do funil está
          vazio porque o dado não existe — não porque ninguém passou por lá.
          Confira se o snippet dispara <code>InitiateCheckout</code>.
        </p>
      )}
    </div>
  );
}
