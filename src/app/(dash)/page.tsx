import { cache, Suspense } from 'react';
import Link from 'next/link';

import { EsqueletoMetrica, EsqueletoQuadro } from '@/components/dash/esqueletos';
import { MetricCard } from '@/components/dash/metric-card';
import { FunilEtapas } from '@/components/dash/funil';
import { ListaRanqueada } from '@/components/dash/lista-ranqueada';
import { ArvoreGeo } from '@/components/dash/arvore-geo';
import { MapaBrasil } from '@/components/dash/mapa-brasil';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { SerieTemporal } from '@/components/dash/serie-temporal';
import { Card } from '@/components/ui/card';
import {
  inteiro,
  moeda,
  multiplo,
  percentual,
  razao,
  simbolo,
  variacao,
} from '@/lib/formato';
import {
  buscarEventosPorTipo,
  buscarGeoArvore,
  buscarPaginas,
  buscarResumo,
  buscarSerieDiaria,
} from '@/lib/painel/consultas';
import { buscarGastoDoPeriodo } from '@/lib/painel/gasto';
import { buscarGastoDiario } from '@/lib/painel/gasto-diario';
import { montarSeriesDoQuadro } from '@/lib/painel/serie';
import { etapaDe, montarFunil } from '@/lib/painel/funil';
import { montarArvoreGeo } from '@/lib/painel/geo-arvore';
import { pintarMapa } from '@/lib/painel/mapa';
import {
  comPeriodo,
  hojeEm,
  intervaloAnterior,
  intervaloDe,
  lerEscolha,
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

/*
 * O gasto no grão de DIA, memoizado pela mesma razão — e é uma ida à Meta
 * separada da de cima, de propósito.
 *
 * A soma da série diária daria o total do cartão numa chamada só, e é
 * tentador. Mas o cartão de gasto, o ROAS e os três custos por evento já
 * rodam há semanas sobre `level=campaign`, e trocar a fonte deles por
 * `level=account` mudaria o número do cartão mais importante do painel sem
 * que eu tenha como conferir contra a API de verdade daqui. O preço de
 * manter as duas é uma consulta a mais por conta a cada 15 minutos — o cache
 * e a fila serial são os mesmos —, e isso é barato perto de mexer no ROAS às
 * cegas.
 */
const gastoDiario = cache(buscarGastoDiario);

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

/**
 * Receita e investimento por dia, no MESMO eixo.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ELE INTEIRO ESPERA A META, E ISSO É DE PROPÓSITO.                        │
 * │                                                                          │
 * │ A receita sai do nosso banco e chega antes. Desenhá-la sozinha e deixar  │
 * │ o investido entrar depois parece melhor e é pior: o teto do eixo é       │
 * │ COMPARTILHADO, então a chegada da segunda linha reescalaria a primeira   │
 * │ — a curva da receita mudaria de forma na frente de quem está olhando,    │
 * │ sem nada ter acontecido. Uma fronteira só, com esqueleto da altura       │
 * │ certa.                                                                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
async function QuadroReceitaGasto({
  intervalo,
  moedaIso,
}: ComIntervalo & { moedaIso: string }) {
  const [serie, gasto] = await Promise.all([
    buscarSerieDiaria(intervalo),
    gastoDiario(intervalo),
  ]);

  /*
   * A montagem é uma função PURA, testada — e não um `if` aqui dentro.
   *
   * A regra que ela carrega ("gasto desconhecido não vira linha no zero") é
   * a que mais custa se quebrar neste quadro, e teste não alcança Server
   * Component. Escrita aqui, ela ficaria sem rede.
   */
  const series = montarSeriesDoQuadro(serie, gasto.porDia);

  return (
    <>
      <SerieTemporal
        series={series}
        formato="moeda"
        simbolo={simbolo(moedaIso)}
      />
      {gasto.porDia === null && (
        <p className="text-muted-foreground text-xs">
          {gasto.contas === 0
            ? 'Só a receita: nenhuma conta de anúncio cadastrada, então o investido é desconhecido — e uma linha no zero afirmaria que você não gastou nada.'
            : 'Só a receita: não consegui ler o gasto na Meta agora. A linha do investido volta sozinha quando ela responder.'}
        </p>
      )}
      {gasto.aviso !== null && gasto.porDia !== null && (
        <p className="text-warning text-xs">{gasto.aviso}</p>
      )}
    </>
  );
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
  const params = await searchParams;
  const escolha = lerEscolha(params);

  const { settings } = await carregarConfiguracao();
  const intervalo = intervaloDe(escolha, settings.timezone);

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
  const [resumo, antes, eventos, geo, paginas] = await Promise.all([
    buscarResumo(intervalo),
    buscarResumo(intervaloAnterior(intervalo)),
    buscarEventosPorTipo(intervalo),
    buscarGeoArvore(intervalo),
    buscarPaginas(intervalo),
  ]);

  const arvoreGeo = montarArvoreGeo(geo);
  /*
   * O mapa sai da MESMA árvore, e não de uma consulta própria: dois
   * caminhos para o mesmo total é garantir que um dia discordam — e aqui a
   * discordância seria um estado pintado de forte ao lado de uma linha
   * dizendo outro número, a meio metro de distância.
   */
  /*
   * O MAPA APARECE SEMPRE, e isso foi uma correção pedida.
   *
   * Ele nasceu condicionado: só desenhava quando havia visitante do Brasil
   * no período. Duas vezes isso deu errado na prática — primeiro sumindo
   * inteiro num período vazio, depois porque a condição em si está errada.
   *
   * Um mapa que vem e vai conforme o dado ensina que a tela é instável.
   * Cinza com "nenhum visitante no período" é uma AFIRMAÇÃO verdadeira e
   * útil; sumir não afirma nada e ainda parece defeito. O argumento que eu
   * tinha para esconder — "loja que vende só para fora ganharia um mapa
   * cinza" — vale menos que a estabilidade da tela, e essa loja vende para
   * o Brasil.
   */
  const mapa = pintarMapa(arvoreGeo);
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
        <SeletorPeriodo atual={escolha} hoje={hojeEm(settings.timezone)} />
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
        Receita e investimento no mesmo quadro — a pergunta que as seis
        métricas de cima respondem no total, respondida ao longo do tempo.
        O título e a explicação ficam FORA do `Suspense`: eles não dependem
        da Meta, e esperar a API para mostrar um título seria deixar o cartão
        sem identidade enquanto carrega.
      */}
      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">
            Receita e investimento, por dia
          </h3>
          <p className="text-muted-foreground text-xs">
            Um eixo só, porque as duas são reais: o <strong>vão</strong> entre
            as linhas é o que sobrou da mídia e o <strong>cruzamento</strong> é
            o ponto de equilíbrio do dia. Receita só{' '}
            <strong>aprovada</strong>; o eixo começa em zero.
          </p>
        </div>
        <Suspense fallback={<EsqueletoQuadro />}>
          <QuadroReceitaGasto
            intervalo={intervalo}
            moedaIso={settings.currency}
          />
        </Suspense>
      </Card>

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
            href={comPeriodo('/paginas', escolha)}
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

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-1 px-4 pt-4 pb-3 sm:px-5">
          <h3 className="text-sm font-semibold tracking-tight">
            De onde vem
          </h3>
          {/*
            O aviso é a chave de leitura, não rodapé. Duas barras por linha,
            e a comparação entre elas é o dado: gente comprida com receita
            curta é tráfego que não converte — e era isso que as duas listas
            antigas pediam para o olho fazer procurando o mesmo nome nas
            duas colunas.
          */}
          <p className="text-muted-foreground text-xs">
            Abra o país para ver os estados, e o estado para ver as cidades. A
            barra <span className="text-success font-medium">verde</span> é
            receita; a <span className="text-chart-1 font-medium">azul</span>,
            visitantes. Uma azul comprida com a verde curta é tráfego que não
            converte.
          </p>
        </div>
        {/*
          O mapa AO LADO, nunca no lugar. No celular ele vem em cima, porque
          a pergunta que ele responde — onde não tem nada — é a de relance, e
          a árvore é a de conferir.

          A ÁRVORE pode ficar vazia; o MAPA não some. São coisas diferentes:
          a árvore lista o que houve, e sem acesso não há o que listar. O
          mapa desenha o país inteiro, e um país cinza é a resposta certa
          para "de onde veio" quando não veio de lugar nenhum.
        */}
        <div className="grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="border-border/60 border-t px-4 py-4 sm:px-5 lg:border-r">
            <MapaBrasil estados={mapa} />
          </div>
          <div className="min-w-0">
            <ArvoreGeo raizes={arvoreGeo} />
          </div>
        </div>
      </Card>

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
