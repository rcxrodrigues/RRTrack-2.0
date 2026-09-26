import {
  EsqueletoCabecalho,
  EsqueletoCartao,
  EsqueletoMetricas,
  EsqueletoTabela,
} from '@/components/dash/esqueletos';

export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <EsqueletoCabecalho />
      <EsqueletoMetricas quantos={6} />
      {/* O gráfico de série: calha do eixo + quadro, na altura real. */}
      <EsqueletoCartao altura="h-56" />
      <EsqueletoTabela linhas={8} />
    </div>
  );
}
