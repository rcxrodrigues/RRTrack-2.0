import {
  EsqueletoCabecalho,
  EsqueletoCartao,
  EsqueletoFunil,
  EsqueletoMetricas,
} from '@/components/dash/esqueletos';

/**
 * Visão geral: seis métricas, funil + eventos lado a lado, páginas e geo.
 *
 * Ver o comentário grande em `esqueletos.tsx` para o porquê: sem este arquivo
 * o Next não pré-carrega a rota e o clique na aba fica sem resposta até o
 * servidor terminar tudo.
 */
export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <EsqueletoCabecalho />
      <EsqueletoMetricas quantos={6} />
      <div className="grid gap-4 lg:grid-cols-2">
        <EsqueletoFunil />
        <EsqueletoCartao linhas={4} />
      </div>
      <EsqueletoCartao linhas={5} />
      <div className="grid gap-4 lg:grid-cols-2">
        <EsqueletoCartao linhas={4} />
        <EsqueletoCartao linhas={4} />
      </div>
    </div>
  );
}
