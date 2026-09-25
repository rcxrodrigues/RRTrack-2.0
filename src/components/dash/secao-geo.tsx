import { ListaRanqueada } from '@/components/dash/lista-ranqueada';
import { Card } from '@/components/ui/card';
import { inteiro, moeda, percentual, razao } from '@/lib/formato';
import type { LinhaGeo } from '@/lib/painel/consultas';

/**
 * Geo em DUAS listas, lado a lado — e não num mapa.
 *
 * Um mapa colorido mostra concentração e nada mais: comparar dois tons de
 * azul é o pior jeito de comparar dois números. O que decide frete, fraude e
 * corte de campanha é o número por região — e a CONVERSÃO por região, que num
 * mapa não cabe.
 *
 * As duas listas ficam juntas de propósito: região que aparece numa e não na
 * outra é tráfego que não converte, e essa comparação é a leitura que
 * interessa.
 */
/** "SP · BR". O país sozinho quando a Vercel não mandou a região. */
function nome(l: LinhaGeo): string {
  return l.regiao ? `${l.regiao} · ${l.pais}` : l.pais;
}

export function SecaoGeo({ linhas }: { linhas: LinhaGeo[] }) {
  if (linhas.length === 0) {
    return (
      <Card className="gap-2 p-4 sm:p-5">
        <h3 className="text-sm font-semibold tracking-tight">Regiões</h3>
        <p className="text-muted-foreground text-sm">
          Nenhum visitante com geo no período. O geo vem dos cabeçalhos da
          Vercel — se o registro <code>track</code> estiver com o proxy do
          Cloudflare ligado (nuvem laranja), eles deixam de valer.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">
            Receita por região
          </h3>
          <p className="text-muted-foreground text-xs">
            Onde o dinheiro entra — não onde há mais gente.
          </p>
        </div>
        <ListaRanqueada
          formatar={(v) => moeda(v)}
          itens={linhas
            .toSorted((a, b) => b.receita - a.receita)
            .slice(0, 8)
            .map((l) => ({
              id: `r-${l.pais}-${l.regiao ?? ''}`,
              rotulo: nome(l),
              valor: l.receita,
              nota: `${inteiro(l.aprovadas)} ${l.aprovadas === 1 ? 'venda' : 'vendas'}`,
            }))}
          vazio="Nenhuma venda com geo no período."
        />
      </Card>

      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">
            Visitantes por região
          </h3>
          <p className="text-muted-foreground text-xs">
            Compare com o de receita: região que aparece aqui e não lá é
            tráfego que não converte.
          </p>
        </div>
        <ListaRanqueada
          itens={linhas
            .toSorted((a, b) => b.visitantes - a.visitantes)
            .slice(0, 8)
            .map((l) => {
              const taxa = razao(l.aprovadas, l.visitantes);
              return {
                id: `v-${l.pais}-${l.regiao ?? ''}`,
                rotulo: nome(l),
                valor: l.visitantes,
                nota: taxa === null ? undefined : percentual(taxa, 1),
              };
            })}
        />
      </Card>
    </div>
  );
}
