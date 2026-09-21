import { PhaseNotice } from '@/components/dash/phase-notice';

export const metadata = { title: 'Eventos' };

export default function EventosPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">Eventos</h2>

      <PhaseNotice phase="Fase 6">
        Tabela filtrável de eventos e o modal com o payload e a resposta de cada destino (Meta e GA4).
      </PhaseNotice>
    </div>
  );
}
