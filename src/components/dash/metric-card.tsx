import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { percentual } from '@/lib/formato';
import { cn } from '@/lib/utils';

/**
 * Cartão de métrica. `value` é `null` quando ainda não há dado — nesse caso
 * mostramos um travessão, nunca um zero: zero é um número, "sem dado" não é.
 */
export function MetricCard({
  label,
  value,
  hint,
  accent = 'primary',
  delta,
  sentido = 'maior-melhor',
}: {
  label: string;
  value: string | null;
  hint?: string;
  accent?: 'primary' | 'cyan' | 'amber' | 'muted';
  /**
   * A variação contra o período anterior, como FRAÇÃO.
   *
   * `null` ou ausente esconde o indicador — e é o certo quando o período
   * anterior foi zero: sair de 0 para 10 não é "+1000%", é uma comparação
   * que não existe.
   */
  delta?: number | null;
  /**
   * Para que lado é bom.
   *
   * Em estornos e recusas, subir é ruim. Sem isto o cartão pintaria de verde
   * um número que piorou — e a cor é o que se lê primeiro num painel.
   */
  sentido?: 'maior-melhor' | 'menor-melhor';
}) {
  const accentClass = {
    primary: 'text-primary-vivid',
    cyan: 'text-cyan',
    amber: 'text-amber',
    muted: 'text-muted-foreground',
  }[accent];

  return (
    <Card className="gap-0 p-4 sm:p-5">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>

      {/*
        `whitespace-nowrap` com corpo menor para valor longo, em vez de deixar
        quebrar: no celular "R$ 37.158,70" partia em duas linhas e o "R$"
        sozinho na primeira lia como dois números. O corte é pelo TAMANHO do
        texto, não por medir no cliente — medir exigiria efeito, e o valor
        já é conhecido no servidor.
      */}
      <span
        data-slot="metric"
        className={cn(
          'mt-2 leading-none font-semibold tracking-tight whitespace-nowrap sm:text-3xl',
          (value?.length ?? 0) > 10 ? 'text-xl' : 'text-2xl',
          value === null ? 'text-muted-foreground/40' : accentClass,
        )}
      >
        {value ?? '—'}
      </span>

      {(delta !== null && delta !== undefined) || hint ? (
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {delta !== null && delta !== undefined && (
            <Delta fracao={delta} sentido={sentido} />
          )}
          {hint ? (
            <span className="text-muted-foreground">{hint}</span>
          ) : null}
        </span>
      ) : null}
    </Card>
  );
}

/**
 * A variação, com seta.
 *
 * A seta não é enfeite: é a codificação secundária. Cor sozinha não serve a
 * quem não distingue verde de vermelho, e o sinal do número é pequeno demais
 * para carregar a informação sozinho.
 */
function Delta({
  fracao,
  sentido,
}: {
  fracao: number;
  sentido: 'maior-melhor' | 'menor-melhor';
}) {
  // Um piso: variação de 0,2% é ruído, e pintar ruído de verde ou vermelho
  // ensina a pessoa a ignorar a cor.
  const parado = Math.abs(fracao) < 0.005;
  const subiu = fracao > 0;
  const bom = sentido === 'maior-melhor' ? subiu : !subiu;

  const Icone = parado ? ArrowRight : subiu ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-0.5 font-medium',
        parado
          ? 'text-muted-foreground'
          : bom
            ? 'text-success'
            : 'text-destructive-vivid',
      )}
    >
      <Icone className="size-3 shrink-0" aria-hidden />
      {percentual(Math.abs(fracao), 0)}
      <span className="sr-only">
        {parado ? 'estável' : subiu ? 'acima' : 'abaixo'} do período anterior
      </span>
    </span>
  );
}
