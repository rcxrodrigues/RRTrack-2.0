import {
  EsqueletoCabecalho,
  EsqueletoMetricas,
  EsqueletoTabela,
} from '@/components/dash/esqueletos';

export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <EsqueletoCabecalho />
      <EsqueletoMetricas quantos={3} />
      <EsqueletoTabela linhas={8} />
    </div>
  );
}
