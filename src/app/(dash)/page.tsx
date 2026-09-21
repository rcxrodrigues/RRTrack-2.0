import { MetricCard } from '@/components/dash/metric-card';
import { PhaseNotice } from '@/components/dash/phase-notice';

export default function VisaoGeralPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">
        Visão geral
      </h2>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard label="Visitantes únicos" value={null} />
        <MetricCard label="Eventos" value={null} accent="cyan" />
        <MetricCard label="Compras" value={null} accent="amber" />
        <MetricCard label="Conversão" value={null} accent="muted" />
      </section>

      <PhaseNotice phase="Fase 6">
        O funil Visitou → Checkout → Compra e os gráficos por período entram
        quando houver dado real chegando pela captura.
      </PhaseNotice>
    </div>
  );
}
