import {
  EsqueletoCabecalho,
  EsqueletoCartao,
  EsqueletoFunil,
  EsqueletoMetricas,
} from '@/components/dash/esqueletos';

/**
 * Visão geral: seis métricas (as três do topo com o rodapé de custo), o
 * funil em linha inteira, as páginas mais visitadas e a árvore de geo —
 * um cartão de largura inteira, não mais as três colunas de antes.
 *
 * Ver o comentário grande em `esqueletos.tsx` para o porquê: sem este arquivo
 * a navegação não troca a tela, ela congela na aba antiga até o servidor
 * terminar.
 */
export default function Carregando() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <EsqueletoCabecalho />
      <EsqueletoMetricas quantos={6} custoAte={3} />
      <EsqueletoFunil />
      <EsqueletoCartao linhas={5} />
      {/* A árvore nasce fechada: o esqueleto mostra os países, não a
          hierarquia aberta. Esqueleto maior que a tela real faz o conteúdo
          saltar quando chega. */}
      <EsqueletoCartao linhas={4} />
    </div>
  );
}
