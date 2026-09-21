import { PhaseNotice } from '@/components/dash/phase-notice';

export const metadata = { title: 'Configuração' };

export default function ConfigPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">Configuração</h2>

      <PhaseNotice phase="Fase 2">
        Cadastro das contas GA4, pixels da Meta e contas de anúncio, com valores mascarados e teste de conexão por conta.
      </PhaseNotice>
    </div>
  );
}
