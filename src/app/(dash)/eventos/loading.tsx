import {
  EsqueletoCabecalho,
  EsqueletoCartao,
  EsqueletoTabela,
} from '@/components/dash/esqueletos';

export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <EsqueletoCabecalho />
      <EsqueletoTabela linhas={10} />
      <EsqueletoCartao linhas={3} />
    </div>
  );
}
