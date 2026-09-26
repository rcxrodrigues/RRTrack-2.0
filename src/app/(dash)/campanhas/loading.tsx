import {
  EsqueletoCabecalho,
  EsqueletoCartao,
  EsqueletoMetricas,
} from '@/components/dash/esqueletos';

export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <EsqueletoCabecalho />
      {/* Gasto · Receita · ROAS · CPA, em quatro colunas como a tela real. */}
      <EsqueletoMetricas quantos={4} colunas={4} />
      {/* A árvore campanha → conjunto → anúncio. */}
      <EsqueletoCartao linhas={6} />
    </div>
  );
}
