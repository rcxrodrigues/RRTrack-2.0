'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { inteiro, moeda, percentual, razao } from '@/lib/formato';
import { totaisDaArvore, type NoGeo } from '@/lib/painel/geo-arvore';

/**
 * Geo em árvore: País > Estado > Cidade.
 *
 * Substitui as três listas soltas. Elas respondiam "quem são os maiores" em
 * cada grão e não respondiam a pergunta que decide frete, prazo e corte de
 * campanha: DE ONDE veio a conversão. Ver "SP" numa lista e "Campinas" na
 * outra não dizia se Campinas estava dentro daquele SP nem quanto pesava
 * nele.
 *
 * Continua não sendo mapa, e pelo mesmo motivo de antes: comparar dois tons
 * de azul é o pior jeito de comparar dois números, e a CONVERSÃO por região
 * — que é a leitura que interessa — num mapa não cabe.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ RECEITA E VISITANTES LADO A LADO, EM TODO NÍVEL.                        │
 * │                                                                          │
 * │ É a comparação que as duas listas antigas faziam por estarem uma ao      │
 * │ lado da outra, e que agora fica na mesma linha: região com gente e sem   │
 * │ receita é tráfego que não converte. Separadas, era preciso procurar o    │
 * │ mesmo nome nas duas colunas; juntas, salta.                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Fechada por padrão: quem abre um país está perguntando dele. O recuo é a
 * única marca de hierarquia — três níveis não pedem mais que isso.
 */
export function ArvoreGeo({ raizes }: { raizes: NoGeo[] }) {
  if (raizes.length === 0) {
    return (
      <p className="text-muted-foreground border-border/60 border-t px-4 py-10 text-center text-sm sm:px-5">
        Nenhum visitante com geo no período. O geo vem dos cabeçalhos da
        Vercel — se o registro <code>track</code> estiver com o proxy do
        Cloudflare ligado (nuvem laranja), eles deixam de valer.
      </p>
    );
  }

  const totais = totaisDaArvore(raizes);

  return (
    <div className="border-border/60 border-t">
      {raizes.map((no) => (
        <No key={no.chave} no={no} nivel={0} totais={totais} />
      ))}
    </div>
  );
}

function No({
  no,
  nivel,
  totais,
}: {
  no: NoGeo;
  nivel: number;
  totais: { visitantes: number; receita: number };
}) {
  const [aberto, setAberto] = React.useState(false);

  /*
   * Um filho só que repete o pai não é ramo — é a mesma linha outra vez.
   * Acontece o tempo todo: um país com um estado só, um estado com uma
   * cidade só. Abrir para ver o mesmo número ensina que abrir não vale a
   * pena, e aí ninguém abre o nó que TEM ramo.
   */
  const vaiAbrir =
    no.filhos.length > 1 ||
    (no.filhos.length === 1 && no.filhos[0]?.rotulo !== no.rotulo);

  const fatiaDaReceita = razao(no.receita, totais.receita);
  const fatiaDeGente = razao(no.visitantes, totais.visitantes);

  return (
    <>
      <div
        className="border-border/60 border-b last:border-0"
        // `padding` e não `margin`: a divisória tem de atravessar a largura
        // inteira, senão a lista vira degrau e o olho perde a linha.
        style={{ paddingLeft: `${String(nivel * 1.25)}rem` }}
      >
        <button
          type="button"
          onClick={() => { setAberto((v) => !v); }}
          disabled={!vaiAbrir}
          aria-expanded={vaiAbrir ? aberto : undefined}
          className="hover:bg-muted/40 flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left transition-colors disabled:cursor-default sm:px-5"
        >
          <span className="w-4 shrink-0">
            {vaiAbrir &&
              (aberto ? (
                <ChevronDown className="text-muted-foreground size-4" />
              ) : (
                <ChevronRight className="text-muted-foreground size-4" />
              ))}
          </span>

          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium">{no.rotulo}</span>
              <span
                data-slot="metric"
                className={
                  no.receita > 0
                    ? 'text-success shrink-0 text-sm font-semibold'
                    : 'text-muted-foreground shrink-0 text-sm'
                }
              >
                {/* Sem venda é travessão, nunca R$ 0,00: aqui zero seria uma
                    afirmação sobre uma região que só teve visita. */}
                {no.receita > 0 ? moeda(no.receita) : '—'}
              </span>
            </span>

            {/*
              Duas barras empilhadas, mesma escala: receita em cima, gente
              embaixo. Barra de gente comprida com barra de receita curta é
              exatamente o "tráfego que não converte" — e aqui isso se vê sem
              ler número nenhum.
            */}
            <span className="flex flex-col gap-1">
              <Barra fracao={fatiaDaReceita} tom="bg-success" />
              <Barra fracao={fatiaDeGente} tom="bg-chart-1" />
            </span>

            <span className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 text-xs">
              <span className="tabular">
                {inteiro(no.visitantes)}{' '}
                {no.visitantes === 1 ? 'visitante' : 'visitantes'}
              </span>
              <span className="tabular">
                {inteiro(no.aprovadas)} {no.aprovadas === 1 ? 'venda' : 'vendas'}
              </span>
              <span className="tabular">
                {/* A conversão do nível — é ela que separa "muita gente" de
                    "gente que compra". */}
                conversão{' '}
                {razao(no.aprovadas, no.visitantes) === null
                  ? '—'
                  : percentual(razao(no.aprovadas, no.visitantes) ?? 0, 2)}
              </span>
            </span>
          </span>
        </button>
      </div>

      {aberto &&
        no.filhos.map((filho) => (
          <No
            key={`${no.chave}/${filho.chave}`}
            no={filho}
            nivel={nivel + 1}
            totais={totais}
          />
        ))}
    </>
  );
}

/**
 * Uma barra, com a mesma regra de três estados do funil.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ZERO não desenha nada; MUITO POUCO desenha um toco de 3px.               │
 * │                                                                          │
 * │ Sem o piso, seis visitantes entre quatro mil viravam meio pixel — que na │
 * │ tela lê como sujeira de renderização, não como valor, e quem vê não sabe │
 * │ se aquilo é um número pequeno ou um defeito. Com o piso no ZERO também,  │
 * │ seria o contrário: uma região sem venda nenhuma ganharia corpo, que é a  │
 * │ compra fantasma do funil por outra porta.                                │
 * │                                                                          │
 * │ Piso em PIXEL e não em porcentagem de propósito: 1,5% de uma barra de    │
 * │ 900px são 13px, largura que já afirma quantidade. O que se quer é o      │
 * │ mínimo para o olho ver que existe.                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
function Barra({ fracao, tom }: { fracao: number | null; tom: string }) {
  const porcento = (fracao ?? 0) * 100;

  return (
    <span className="bg-muted/40 block h-1.5 w-full overflow-hidden rounded-full">
      {porcento > 0 && (
        <span
          className={`block h-full min-w-[3px] rounded-full ${tom}`}
          style={{ width: `${String(Math.min(100, porcento))}%` }}
        />
      )}
    </span>
  );
}
