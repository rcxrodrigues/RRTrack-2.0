import { cache, Suspense } from 'react';
import Link from 'next/link';

import { EsqueletoMetrica } from '@/components/dash/esqueletos';
import { MetricCard } from '@/components/dash/metric-card';
import { FunilEtapas } from '@/components/dash/funil';
import { ListaRanqueada } from '@/components/dash/lista-ranqueada';
import { SecaoGeo } from '@/components/dash/secao-geo';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { Card } from '@/components/ui/card';
import { inteiro, moeda, multiplo, percentual, razao, variacao } from '@/lib/formato';
import {
  buscarCidades,
  buscarEventosPorTipo,
  buscarGeo,
  buscarPaginas,
  buscarResumo,
} from '@/lib/painel/consultas';
import { buscarGastoDoPeriodo } from '@/lib/painel/gasto';
import { etapaDe, montarFunil } from '@/lib/painel/funil';
import {
  comPeriodo,
  intervaloAnterior,
  intervaloDe,
  lerPeriodo,
  type Intervalo,
} from '@/lib/painel/periodo';
import { caminhoDaUrl } from '@/lib/painel/url';
import { carregarConfiguracao } from '@/lib/settings';

export const metadata = { title: 'Visão geral' };

/** Painel de operação: a razão de abrir é ver o que está acontecendo agora. */
export const dynamic = 'force-dynamic';

/*
 * O gasto, buscado UMA vez por renderização.
 *
 * Três lugares o pedem — o cartão de gasto, o de ROAS e o aviso —, e cada um
 * vive no seu próprio `Suspense` para um não segurar o outro. Sem o `cache()`
 * do React seriam três idas à API da Meta na mesma tela: três vezes a cota,
 * três vezes o tempo. Com ele, o primeiro que pedir busca e os outros dois
 * esperam a mesma promessa.
 *
 * A memoização é por IDENTIDADE do argumento, e é por isso que os três
 * recebem o MESMO objeto `intervalo`, montado uma vez na página. Montar um
 * intervalo novo em cada componente passaria pelo cache sem acertar nada.
 */
const gastoDoPeriodo = cache(buscarGastoDoPeriodo);

type ComIntervalo = { intervalo: Intervalo };

async function CartaoGasto({ intervalo }: ComIntervalo) {
  const gasto = await gastoDoPeriodo(intervalo);

  return (
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
  );
}

async function CartaoRoas({
  intervalo,
  receita,
}: ComIntervalo & { receita: number }) {
  const gasto = await gastoDoPeriodo(intervalo);

  /*
   * ROAS: `null` sempre que um dos dois lados não existe.
   *
   * Sem conta de anúncio o gasto é desconhecido, não zero — e receita
   * dividida por zero daria infinito. Gasto zero com conta cadastrada é
   * medida real (a campanha não rodou), e aí também não há retorno SOBRE
   * gasto para calcular.
   */
  const roas =
    gasto.total !== null && gasto.total > 0 ? receita / gasto.total : null;

  return (
    <MetricCard
      label="ROAS"
      value={roas === null ? null : multiplo(roas)}
      accent="muted"
      hint={
        gasto.total === null
          ? 'falta o gasto para calcular'
          : 'receita ÷ gasto, sobre vendas aprovadas'
      }
    />
  );
}

/**
 * Gasto ÷ quantidade — o custo por visitante, por checkout, por compra.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS CAMINHOS PARA `—`, E NENHUM DELES É ZERO.                           │
 * │                                                                          │
 * │ · sem conta de anúncio  → o gasto é DESCONHECIDO, não zero               │
 * │ · quantidade zero       → dividir por zero não dá número                 │
 * │                                                                          │
 * │ Gasto zero COM conta cadastrada é outra coisa: é medida real (a campanha │
 * │ não rodou), e R$ 0,00 por visitante é verdade. Por isso o teste é        │
 * │ `total === null`, não `total <= 0` — os dois somem na mesma condição se  │
 * │ escritos com pressa, e aí a tela passa a esconder um número certo.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
async function CustoPor({
  intervalo,
  quantidade,
}: ComIntervalo & { quantidade: number }) {
  const gasto = await gastoDoPeriodo(intervalo);

  if (gasto.total === null || quantidade <= 0) {
    return <span className="text-muted-foreground/40">—</span>;
  }

  return <>{moeda(gasto.total / quantidade)}</>;
}

async function AvisoDoGasto({ intervalo }: ComIntervalo) {
  const gasto = await gastoDoPeriodo(intervalo);
  if (!gasto.aviso) return null;

  return (
    <Card className="gap-1 p-4 sm:p-5">
      <h3 className="text-sm font-semibold tracking-tight">Gasto de mídia</h3>
      <p className="text-warning text-sm">{gasto.aviso}</p>
    </Card>
  );
}

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

  /*
   * Independentes entre si — em série seriam cinco idas esperando uma pela
   * outra sem motivo.
   *
   * O GASTO NÃO ESTÁ AQUI, e isso é o ponto. Ele é o único dado desta tela
   * que não sai do nosso banco: vai à API da Meta, e na pior hora (cache de
   * 15 minutos vencido, fila serial por conta) é de longe o mais lento.
   * Dentro deste `Promise.all` ele prendia a tela INTEIRA — as contagens já
   * estavam prontas e ninguém as via. Agora ele entra em `Suspense`, por
   * último, e só os dois cartões que dependem dele esperam.
   */
  const [resumo, antes, eventos, geo, cidades, paginas] = await Promise.all([
    buscarResumo(intervalo),
    buscarResumo(intervaloAnterior(intervalo)),
    buscarEventosPorTipo(intervalo),
    buscarGeo(intervalo),
    buscarCidades(intervalo),
    buscarPaginas(intervalo),
  ]);

  const funil = montarFunil(resumo.visitantes, eventos, resumo.aprovadas);
  // Por `id`, nunca por índice: o carrinho entrou no meio do funil, e
  // `etapas[1]` passaria a ser ele — sem erro nenhum aparecer.
  const checkout = etapaDe(funil, 'checkout');
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
          custoRotulo="por visitante"
          /*
            Em `Suspense` próprio: o custo depende do gasto, que vem da API da
            Meta. Sem isto, o cartão de visitantes — cujo número já está
            pronto — passaria a esperar a Meta para aparecer.
          */
          custo={
            <Suspense fallback={<span className="text-muted-foreground/40">·</span>}>
              <CustoPor intervalo={intervalo} quantidade={resumo.visitantes} />
            </Suspense>
          }
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
          custoRotulo="por checkout"
          custo={
            <Suspense fallback={<span className="text-muted-foreground/40">·</span>}>
              <CustoPor
                intervalo={intervalo}
                /*
                  Etapa desconhecida conta como ZERO aqui, e o `CustoPor`
                  devolve `—`. É o certo: sem o evento não se sabe quantos
                  chegaram ao checkout, e dividir o gasto por um número que
                  não existe inventaria um custo.
                */
                quantidade={checkout?.desconhecido ? 0 : (checkout?.total ?? 0)}
              />
            </Suspense>
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
          custoRotulo="por compra"
          custo={
            <Suspense fallback={<span className="text-muted-foreground/40">·</span>}>
              <CustoPor intervalo={intervalo} quantidade={resumo.aprovadas} />
            </Suspense>
          }
        />

        <Suspense fallback={<EsqueletoMetrica />}>
          <CartaoGasto intervalo={intervalo} />
        </Suspense>
        <MetricCard
          label="Receita"
          value={resumo.aprovadas > 0 ? moeda(resumo.receita) : null}
          delta={variacao(resumo.receita, antes.receita)}
          hint={ticket === null ? undefined : `ticket ${moeda(ticket)}`}
        />
        <Suspense fallback={<EsqueletoMetrica />}>
          <CartaoRoas intervalo={intervalo} receita={resumo.receita} />
        </Suspense>
      </section>

      {/* Sem fallback: um aviso que talvez não exista não reserva espaço. */}
      <Suspense fallback={null}>
        <AvisoDoGasto intervalo={intervalo} />
      </Suspense>

      {/*
        O funil sozinho na linha. O cartão "Eventos por tipo" que dividia o
        espaço com ele SAIU: as quatro barras dele eram PageView, AddToCart,
        InitiateCheckout e Purchase — exatamente as quatro etapas do funil ao
        lado, nos mesmos números. Dois desenhos do mesmo dado, lado a lado,
        não somam leitura: fazem quem olha conferir um contra o outro.
        A consulta continua (`buscarEventosPorTipo`) porque é ela que ALIMENTA
        o funil, e o filtro por tipo da aba de Eventos vive dela.
      */}
      <div className="grid gap-4">
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

      <SecaoGeo linhas={geo} cidades={cidades} />

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
