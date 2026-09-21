import { Card } from '@/components/ui/card';

/**
 * Marcador honesto para as telas que ainda não foram construídas: diz em qual
 * fase o conteúdo chega, em vez de fingir dados.
 */
export function PhaseNotice({
  phase,
  children,
}: {
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-dashed">
      <div className="flex flex-col gap-2 px-5 py-8 text-center sm:py-12">
        <span className="text-primary-vivid/80 font-mono text-xs tracking-wide uppercase">
          {phase}
        </span>
        <p className="text-muted-foreground mx-auto max-w-prose text-sm">
          {children}
        </p>
      </div>
    </Card>
  );
}
