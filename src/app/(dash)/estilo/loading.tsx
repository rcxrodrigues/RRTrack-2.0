import { EsqueletoCartao } from '@/components/dash/esqueletos';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Estilo — a página do design system.
 *
 * Existe porque `loading.tsx` do `(dash)` vale para TODA rota abaixo dele
 * que não tenha a sua: sem este arquivo, clicar em Estilo mostrava o
 * esqueleto da VISÃO GERAL — seis métricas, funil, geo — e depois trocava
 * por uma página de paleta e tokens, que não tem nada disso. Esqueleto com a
 * geometria de outra tela é pior que nenhum, e este era de outra tela
 * inteira.
 *
 * Aqui não há seletor de período nem métricas: é título, e blocos de
 * demonstração empilhados.
 */
export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <Skeleton className="h-6 w-20 md:hidden" />
      <EsqueletoCartao altura="h-32" />
      <EsqueletoCartao altura="h-48" />
      <EsqueletoCartao altura="h-40" />
      <EsqueletoCartao altura="h-56" />
    </div>
  );
}
