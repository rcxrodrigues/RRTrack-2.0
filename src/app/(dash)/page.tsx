import Link from 'next/link';

import { MetricCard } from '@/components/dash/metric-card';
import { FunilEtapas } from '@/components/dash/funil';
import { ListaRanqueada } from '@/components/dash/lista-ranqueada';
import { SecaoGeo } from '@/components/dash/secao-geo';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { Card } from '@/components/ui/card';
import { inteiro, moeda, percentual, razao, variacao } from '@/lib/formato';
import {
  buscarEventosPorTipo,
  buscarGeo,
  buscarPaginas,
  buscarResumo,
} from '@/lib/painel/consultas';
import { corDoEvento } from '@/lib/painel/cores-evento';
import { buscarGastoDoPeriodo } from '@/lib/painel/gasto';
import { etapaDe, montarFunil } from '@/lib/painel/funil';
import {
  comPeriodo,
  intervaloAnterior,
  intervaloDe,
  lerPeriodo,
} from '@/lib/painel/periodo';
import { caminhoDaUrl } from '@/lib/painel/url';
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

  // Independentes entre si — em série seriam cinco idas esperando uma pela
  // outra sem motivo. O gasto vai junto porque o ROAS precisa dos dois lados.
  const [resumo, antes, eventos, geo, paginas, gasto] = await Promise.all([
    buscarResumo(intervalo),
    buscarResumo(intervaloAnterior(intervalo)),
    buscarEventosPorTipo(intervalo),
    buscarGeo(intervalo),
    buscarPaginas(intervalo),
    buscarGastoDoPeriodo(intervalo),
  ]);

  const funil = montarFunil(resumo.visitantes, eventos, resumo.aprovadas);
  // Por `id`, nunca por índice: o carrinho entrou no meio do funil, e
  // `etapas[1]` passaria a ser ele — sem erro nenhum aparecer.
  const checkout = etapaDe(funil, 'checkout');
  const conversao = razao(resumo.aprovadas, resumo.visitantes);
  const ticket = razao(resumo.receita, resumo.aprovadas);

  /*
   * ROAS: `null` sempre que um dos dois lados não existe.
   *
   * Sem conta de anúncio o gasto é desconhecido, não zero — e receita
   * dividida por zero daria infinito. Gasto zero com conta cadastrada é
   * medida real (a campanha não rodou), e aí também não há retorno SOBRE
   * gasto para calcular.
   */
  const roas =
    gasto.total !== null && gasto.total > 0 ? resumo.receita / gasto.total : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">
          Visão geral
        </h2>
        <SeletorPeriodo atual={periodo} />
      </div>

      {/*
        Duas linhas de três, e a ordem é o caminho do dinheiro: quem chegou,
        quem foi ao checkout, quem comprou — depois quanto custou, quanto
        entrou e qual o retorno.
      */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard
          label="Visitantes únicos"
          value={inteiro(resumo.visitantes)}
          delta={variacao(resumo.visitantes, antes.visitantes)}
          hint={`${inteiro(resumo.identificados)} identificados`}
        />
        <MetricCard
          label="Chegaram no checkout"
          // Sem o evento, é `—` e não zero: o dado não existe, e afirmar
          // zero culparia a oferta por uma falha de instalação.
          value={checkout?.desconhecido ? null : inteiro(checkout?.total ?? 0)}
          accent="cyan"
          hint={
            checkout?.desconhecido
              ? 'o snippet não dispara InitiateCheckout'
              : checkout?.doTopo === null || checkout?.doTopo === undefined
                ? undefined
                : `${percentual(checkout.doTopo)} dos visitantes`
          }
        />
        <MetricCard
          label="Compras"
          value={inteiro(resumo.aprovadas)}
          accent="amber"
          delta={variacao(resumo.aprovadas, antes.aprovadas)}
          hint={
            conversao === null ? undefined : `${percentual(conversao, 2)} de conversão`
          }
        />

        <MetricCard
          label="Gasto"
          value={gasto.total === null ? null : moeda(gasto.total)}
          sentido="menor-melhor"
          hint={
            gasto.total === null
              ? 'nenhuma conta de anúncio cadastrada'
              : `${inteiro(gasto.contas)} ${gasto.contas === 1 ? 'conta' : 'contas'} de anúncio`
          }
        />
        <MetricCard
          label="Receita"
          value={resumo.aprovadas > 0 ? moeda(resumo.receita) : null}
          delta={variacao(resumo.receita, antes.receita)}
          hint={ticket === null ? undefined : `ticket ${moeda(ticket)}`}
        />
        <MetricCard
          label="ROAS"
          value={roas === null ? null : `${roas.toFixed(2)}×`}
          accent="muted"
          hint={
            gasto.total === null
              ? 'falta o gasto para calcular'
              : 'receita ÷ gasto, sobre vendas aprovadas'
          }
        />
      </section>

      {gasto.aviso && (
        <Card className="gap-1 p-4 sm:p-5">
          <h3 className="text-sm font-semibold tracking-tight">Gasto de mídia</h3>
          <p className="text-warning text-sm">{gasto.aviso}</p>
        </Card>
      )}

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
            // A cor vem de `cores-evento.ts`, a mesma que a tabela de eventos
            // usa — cor só vira atalho se for a MESMA em todo lugar.
            itens={eventos.map((e) => ({
              id: e.nome,
              valor: e.total,
              cor: corDoEvento(e.nome),
              nota: `${inteiro(e.visitantes)} ${e.visitantes === 1 ? 'pessoa' : 'pessoas'}`,
            }))}
            vazio="Nenhum evento chegou neste período. Confira se o snippet está na página."
          />
        </Card>
      </div>

      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">
              Páginas mais visitadas
            </h3>
            <p className="text-muted-foreground text-xs">
              Visitantes únicos, e a conversão de cada uma ao lado.
            </p>
          </div>
          {/*
            O link leva o período junto: chegar em Páginas vendo outro
            intervalo faria os números não baterem com os de cima, e a
            primeira conclusão de quem olha seria que o painel erra.
          */}
          <Link
            href={comPeriodo('/paginas', periodo)}
            className="text-primary-vivid text-xs hover:underline"
          >
            ver todas
          </Link>
        </div>
        <ListaRanqueada
          limite={5}
          itens={paginas.map((p) => {
            const taxa = razao(p.compras, p.visitantes);
            return {
              id: p.url,
              rotulo: caminhoDaUrl(p.url),
              valor: p.visitantes,
              // A conversão, não a contagem de compras: a pergunta que a
              // lista responde é "qual página vale o tráfego que recebe?", e
              // isso é razão, não volume.
              nota: taxa === null ? undefined : percentual(taxa, 2),
            };
          })}
          vazio="Nenhuma página com tráfego no período. O snippet precisa estar na página."
        />
      </Card>

      <SecaoGeo linhas={geo} />

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
