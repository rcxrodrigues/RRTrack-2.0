import { EsqueletoCartao } from '@/components/dash/esqueletos';
import { Skeleton } from '@/components/ui/skeleton';

/** Configuração não tem seletor de período — só o título e as seções. */
export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <Skeleton className="h-6 w-36 md:hidden" />
      <EsqueletoCartao altura="h-28" />
      <EsqueletoCartao altura="h-40" />
      <EsqueletoCartao altura="h-40" />
      <EsqueletoCartao altura="h-40" />
    </div>
  );
}
