import { Card } from '@/components/ui/card';
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
}: {
  label: string;
  value: string | null;
  hint?: string;
  accent?: 'primary' | 'cyan' | 'amber' | 'muted';
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

      <span
        data-slot="metric"
        className={cn(
          'mt-2 text-2xl leading-none font-semibold tracking-tight sm:text-3xl',
          value === null ? 'text-muted-foreground/40' : accentClass,
        )}
      >
        {value ?? '—'}
      </span>

      {hint ? (
        <span className="text-muted-foreground mt-2 text-xs">{hint}</span>
      ) : null}
    </Card>
  );
}
