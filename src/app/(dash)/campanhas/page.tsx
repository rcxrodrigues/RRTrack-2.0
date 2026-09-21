import { PhaseNotice } from '@/components/dash/phase-notice';

export const metadata = { title: 'Campanhas' };

export default function CampanhasPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">Campanhas</h2>

      <PhaseNotice phase="Fase 7">
        Insights do Meta Ads cruzados com a receita por UTM, em árvore campanha → conjunto → anúncio, com ROAS e CPA.
      </PhaseNotice>
    </div>
  );
}
