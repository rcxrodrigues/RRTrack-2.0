import { MetricCard } from '@/components/dash/metric-card';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { Card } from '@/components/ui/card';
import { inteiro, moeda, percentual, razao } from '@/lib/formato';
import { buscarPaginas } from '@/lib/painel/consultas';
import { intervaloDe, lerPeriodo } from '@/lib/painel/periodo';
import { carregarConfiguracao } from '@/lib/settings';

export const metadata = { title: 'Páginas' };
export const dynamic = 'force-dynamic';

/** O caminho, sem o domínio — é ele que identifica a página para quem edita. */
function caminho(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '');
  } catch {
    // URL que não parseia é dado real que chegou torto: mostra como veio, em
    // vez de sumir da tabela. Página some da lista é pior que página feia.
    return url;
  }
}

export default async function PaginasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { periodo: bruto } = await searchParams;
  const periodo = lerPeriodo(bruto);

  const { settings } = await carregarConfiguracao();
  const intervalo = intervaloDe(periodo, settings.timezone);
  const paginas = await buscarPaginas(intervalo);

  const totalVisitantes = paginas.reduce((s, p) => s + p.visitantes, 0);
  const comCheckout = paginas.filter((p) => p.checkouts > 0).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">Páginas</h2>
        <SeletorPeriodo atual={periodo} />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard
          label="Páginas com tráfego"
          value={paginas.length > 0 ? inteiro(paginas.length) : null}
        />
        <MetricCard
          label="Páginas que levam ao checkout"
          value={paginas.length > 0 ? inteiro(comCheckout) : null}
          accent="cyan"
          hint={
            paginas.length > 0 && comCheckout < paginas.length
              ? `${inteiro(paginas.length - comCheckout)} não levaram ninguém`
              : undefined
          }
        />
        <MetricCard
          label="Visitas contadas"
          value={totalVisitantes > 0 ? inteiro(totalVisitantes) : null}
          accent="muted"
          hint="soma por página, com repetição"
        />
      </section>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-1 px-4 pt-4 pb-3 sm:px-5">
          <h3 className="text-sm font-semibold tracking-tight">
            Conversão por página
          </h3>
          {/*
            O aviso não é rodapé — é a condição para ler a tabela. Quem passou
            por três páginas e comprou conta nas três, então somar a coluna de
            compras dá mais que o faturamento. Sem dizer isso, o primeiro
            instinto de quem olha é achar que o painel está errado.
          */}
          <p className="text-muted-foreground text-xs">
            Um visitante que viu três páginas conta nas três, então a soma das
            colunas <strong>não</strong> fecha com o total do painel. A
            pergunta aqui é "esta página participa de vendas?", não "qual
            levou o crédito?".
          </p>
        </div>

        {paginas.length === 0 ? (
          <p className="text-muted-foreground border-border/60 border-t px-4 py-10 text-center text-sm sm:px-5">
            Nenhuma página com tráfego no período. O snippet precisa estar na
            página para ela aparecer aqui.
          </p>
        ) : (
          <div className="border-border/60 border-t">
            {paginas.slice(0, 50).map((p) => {
              const aoCheckout = razao(p.checkouts, p.visitantes);
              const aCompra = razao(p.compras, p.visitantes);
              return (
                <div
                  key={p.url}
                  className="border-border/60 flex flex-col gap-2 border-b px-4 py-3 last:border-0 sm:px-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-sm" title={p.url}>
                      {caminho(p.url)}
                    </span>
                    <span
                      data-slot="metric"
                      className={
                        aCompra === null
                          ? 'text-muted-foreground shrink-0 text-sm'
                          : 'text-success shrink-0 text-sm font-semibold'
                      }
                    >
                      {aCompra === null ? '—' : percentual(aCompra, 2)}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                    <span className="tabular">
                      {inteiro(p.visitantes)} {p.visitantes === 1 ? 'visitante' : 'visitantes'}
                    </span>
                    <span className="tabular">
                      {inteiro(p.checkouts)} ao checkout
                      {aoCheckout !== null && ` · ${percentual(aoCheckout, 1)}`}
                    </span>
                    <span className="tabular">
                      {inteiro(p.compras)} {p.compras === 1 ? 'compra' : 'compras'}
                    </span>
                    {p.receita > 0 && (
                      <span className="tabular">{moeda(p.receita)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
