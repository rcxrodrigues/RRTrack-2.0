import { PhaseNotice } from '@/components/dash/phase-notice';

export const metadata = { title: 'Geo' };

export default function GeoPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">Geo</h2>

      <PhaseNotice phase="Fase 6">
        Mapa por região, montado a partir do geo derivado do IP de cada visita.
      </PhaseNotice>
    </div>
  );
}
