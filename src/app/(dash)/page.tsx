import { MetricCard } from '@/components/dash/metric-card';
import { FunilEtapas } from '@/components/dash/funil';
import { ListaRanqueada } from '@/components/dash/lista-ranqueada';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { Card } from '@/components/ui/card';
import { inteiro, moeda, percentual, razao, variacao } from '@/lib/formato';
import { buscarEventosPorTipo, buscarResumo } from '@/lib/painel/consultas';
import { montarFunil } from '@/lib/painel/funil';
import { intervaloAnterior, intervaloDe, lerPeriodo } from '@/lib/painel/periodo';
import { carregarConfiguracao } from '@/lib/settings';

export const metadata = { title: 'Visão geral' };

/** Painel de operação: a razão de abrir é ver o que está acontecendo agora. */
export const dynamic = 'force-dynamic';

export default async function VisaoGeralPage({
  searchParams,
}: {
  // No Next 16 `searchParams` é uma Promise — ver node_modules/next/dist/docs.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { periodo: bruto } = await searchParams;
  const periodo = lerPeriodo(bruto);

  const { settings } = await carregarConfiguracao();
  const intervalo = intervaloDe(periodo, settings.timezone);

  // As três consultas são independentes — em série seriam três idas ao banco
  // esperando uma pela outra sem motivo.
  const [resumo, antes, eventos] = await Promise.all([
    buscarResumo(intervalo),
    buscarResumo(intervaloAnterior(intervalo)),
    buscarEventosPorTipo(intervalo),
  ]);

  const funil = montarFunil(resumo.visitantes, eventos, resumo.aprovadas);
  const conversao = razao(resumo.aprovadas, resumo.visitantes);
  const ticket = razao(resumo.receita, resumo.aprovadas);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">
          Visão geral
        </h2>
        <SeletorPeriodo atual={periodo} />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          label="Visitantes"
          value={inteiro(resumo.visitantes)}
          delta={variacao(resumo.visitantes, antes.visitantes)}
          hint={`${inteiro(resumo.identificados)} identificados`}
        />
        <MetricCard
          label="Eventos"
          value={inteiro(resumo.eventos)}
          accent="cyan"
          delta={variacao(resumo.eventos, antes.eventos)}
        />
        <MetricCard
          label="Compras"
          value={inteiro(resumo.aprovadas)}
          accent="amber"
          delta={variacao(resumo.aprovadas, antes.aprovadas)}
          hint={conversao === null ? undefined : `${percentual(conversao, 2)} de conversão`}
        />
        <MetricCard
          label="Receita"
          value={resumo.aprovadas > 0 ? moeda(resumo.receita) : null}
          delta={variacao(resumo.receita, antes.receita)}
          hint={ticket === null ? undefined : `ticket ${moeda(ticket)}`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-4 p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">Funil</h3>
            <p className="text-muted-foreground text-xs">
              Pessoas, não eventos: quem abriu o checkout três vezes é uma
              pessoa.
            </p>
          </div>
          <FunilEtapas funil={funil} />
        </Card>

        <Card className="gap-4 p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">
              Eventos por tipo
            </h3>
            <p className="text-muted-foreground text-xs">
              A barra compara com o maior do período, não com o total.
            </p>
          </div>
          <ListaRanqueada
            itens={eventos.map((e) => ({
              id: e.nome,
              valor: e.total,
              nota: `${inteiro(e.visitantes)} pessoas`,
            }))}
            vazio="Nenhum evento chegou neste período. Confira se o snippet está na página."
          />
        </Card>
      </div>

      {/*
        A saúde da atribuição, e não um detalhe: venda órfã entra na receita e
        SAI do ROAS por campanha. Se este número cresce, o painel de campanhas
        vai ficando cego sem avisar — e aí o número que não fecha é o que a
        pessoa usa para decidir onde gastar.
      */}
      {resumo.aprovadas > 0 && (
        <Card className="gap-2 p-4 sm:p-5">
          <h3 className="text-sm font-semibold tracking-tight">Atribuição</h3>
          <p className="text-muted-foreground text-sm">
            {resumo.semAtribuicao === 0 ? (
              <>
                As {inteiro(resumo.aprovadas)} compras do período casaram com
                um visitante. O ROAS por campanha cobre tudo.
              </>
            ) : (
              <>
                <strong className="text-warning">
                  {inteiro(resumo.semAtribuicao)} de {inteiro(resumo.aprovadas)}
                </strong>{' '}
                compras não casaram com nenhum visitante. Elas contam na receita
                e <strong>não</strong> aparecem no ROAS por campanha — a ponte
                do <code>trck_user_id</code> não chegou até o checkout, ou o
                comprador nunca deixou o e-mail na página.
              </>
            )}
          </p>
        </Card>
      )}
    </div>
  );
}
