import { PhaseNotice } from '@/components/dash/phase-notice';

export const metadata = { title: 'Faturamento' };

export default function FaturamentoPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">Faturamento</h2>

      <PhaseNotice phase="Fase 6">
        Receita, ticket médio, reembolsos e a tabela de compras vinda do webhook.
      </PhaseNotice>
    </div>
  );
}
