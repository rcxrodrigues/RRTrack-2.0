import Link from 'next/link';

import { MetricCard } from '@/components/dash/metric-card';
import { Quando } from '@/components/dash/quando';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { SerieTemporal } from '@/components/dash/serie-temporal';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { inteiro, moeda, razao, variacao } from '@/lib/formato';
import {
  buscarCompras,
  COMPRAS_POR_PAGINA,
  lerFiltroCompras,
} from '@/lib/painel/compras-lista';
import { buscarResumo, buscarSerieDiaria } from '@/lib/painel/consultas';
import { intervaloAnterior, intervaloDe, lerPeriodo } from '@/lib/painel/periodo';
import { carregarConfiguracao } from '@/lib/settings';
import { STATUS_COMPRA } from '@/lib/webhooks/tipos';

export const metadata = { title: 'Faturamento' };

export const dynamic = 'force-dynamic';

/** A cor do selo por status. Verde só para o que virou dinheiro. */
const TOM = {
  aprovada: 'success',
  pendente: 'default',
  recusada: 'default',
  estornada: 'warning',
  chargeback: 'destructive',
} as const;

/**
 * As UTMs da venda, na ordem da árvore da Meta e sem as vazias.
 *
 * Separador `·` entre campos diferentes e `›` dentro da hierarquia: sem essa
 * distinção, `facebook · cpc · CAMP · CONJ · AD` lê como cinco coisas soltas,
 * quando três delas são um caminho.
 */
function origem(linha: {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}): string[] {
  const fonte = [linha.utmSource, linha.utmMedium].filter(Boolean).join(' · ');
  const arvore = [linha.utmCampaign, linha.utmTerm, linha.utmContent]
    .filter(Boolean)
    .join(' › ');
  return [fonte, arvore].filter(Boolean);
}

export default async function FaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const periodo = lerPeriodo(params.periodo);
  const filtro = lerFiltroCompras(params);

  const { settings } = await carregarConfiguracao();
  const intervalo = intervaloDe(periodo, settings.timezone);

  const [resumo, antes, serie, { linhas, total }] = await Promise.all([
    buscarResumo(intervalo),
    buscarResumo(intervaloAnterior(intervalo)),
    buscarSerieDiaria(intervalo),
    buscarCompras(intervalo, filtro),
  ]);

  const ticket = razao(resumo.receita, resumo.aprovadas);
  const liquida = resumo.receita - resumo.devolvido;

  const ultimaPagina = Math.max(0, Math.ceil(total / COMPRAS_POR_PAGINA) - 1);
  const link = (extra: Record<string, string>): string => {
    const q = new URLSearchParams({ periodo, ...extra });
    return `?${q.toString()}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">
          Faturamento
        </h2>
        <SeletorPeriodo atual={periodo} />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          label="Receita"
          value={resumo.aprovadas > 0 ? moeda(resumo.receita) : null}
          delta={variacao(resumo.receita, antes.receita)}
          hint={`${inteiro(resumo.aprovadas)} vendas`}
        />
        <MetricCard
          label="Ticket médio"
          value={ticket === null ? null : moeda(ticket)}
          accent="cyan"
          delta={variacao(
            ticket ?? 0,
            razao(antes.receita, antes.aprovadas) ?? 0,
          )}
        />
        <MetricCard
          label="Devolvido"
          value={resumo.estornadas > 0 ? moeda(resumo.devolvido) : null}
          accent="amber"
          delta={variacao(resumo.devolvido, antes.devolvido)}
          // Estorno subindo é ruim: sem isto o cartão pintaria de verde um
          // número que piorou, e a cor é o que se lê primeiro.
          sentido="menor-melhor"
          hint={`${inteiro(resumo.estornadas)} estornos`}
        />
        <MetricCard
          label="Receita líquida"
          value={resumo.aprovadas > 0 ? moeda(liquida) : null}
          accent="muted"
          hint="aprovada menos o que voltou"
        />
      </section>

      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">Receita por dia</h3>
          <p className="text-muted-foreground text-xs">
            Só <strong>aprovada</strong>. Pendente é boleto que ninguém pagou;
            estornada é dinheiro que voltou. O eixo começa em zero — cortar a
            base faria 2% parecer um pico.
          </p>
        </div>
        <SerieTemporal
          pontos={serie.map((p) => ({ dia: p.dia, valor: p.receita }))}
          formato="moeda"
          simbolo={simbolo(settings.currency)}
          rotulo="de receita"
        />
      </Card>

      {/*
        O aviso que o painel PRECISA dar, e que nenhum outro sistema dá: o
        ROAS da Meta é otimista por desenho dela. Ela não tem reversão — a
        conversão já contada continua contada mesmo depois do estorno.
      */}
      {resumo.estornadas > 0 && (
        <Card className="gap-2 p-4 sm:p-5">
          <h3 className="text-sm font-semibold tracking-tight">
            Por que este número não bate com o da Meta
          </h3>
          <p className="text-muted-foreground text-sm">
            {inteiro(resumo.estornadas)}{' '}
            {resumo.estornadas === 1 ? 'venda voltou' : 'vendas voltaram'} no
            período, somando <strong>{moeda(resumo.devolvido)}</strong>. O GA4
            recebe o <code>refund</code> e subtrai sozinho; a{' '}
            <strong>Conversions API não tem reversão</strong> — não existe
            anti-<code>Purchase</code>. A conversão já contada continua contada
            lá. Quando os dois divergirem, <strong>o certo é este</strong>.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight">Vendas</h3>
            <span className="text-muted-foreground tabular text-xs">
              {inteiro(total)} no período
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Link
              href={link({})}
              className={
                filtro.status === ''
                  ? 'bg-primary text-primary-foreground flex h-8 items-center rounded-md px-3 text-xs font-medium'
                  : 'ring-border text-muted-foreground hover:text-foreground flex h-8 items-center rounded-md px-3 text-xs ring-1'
              }
            >
              Todas
            </Link>
            {STATUS_COMPRA.map((status) => (
              <Link
                key={status}
                href={link({ status })}
                className={
                  filtro.status === status
                    ? 'bg-primary text-primary-foreground flex h-8 items-center rounded-md px-3 text-xs font-medium'
                    : 'ring-border text-muted-foreground hover:text-foreground flex h-8 items-center rounded-md px-3 text-xs ring-1'
                }
              >
                {status}
              </Link>
            ))}
          </div>
        </div>

        {linhas.length === 0 ? (
          <p className="text-muted-foreground border-border/60 border-t px-4 py-8 text-center text-sm sm:px-5">
            Nenhuma venda neste período com este filtro.
          </p>
        ) : (
          <div className="border-border/60 border-t">
            {linhas.map((linha) => (
              <div
                key={linha.id}
                className="border-border/60 flex flex-col gap-1 border-b px-4 py-3 last:border-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6 sm:px-5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {linha.produto ?? linha.transactionId}
                  </span>
                  <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 text-xs">
                    {linha.email && <span className="truncate">{linha.email}</span>}
                    {/*
                      As CINCO UTMs, não só a campanha. Numa venda que não
                      fecha com o ROAS, a resposta costuma estar no campo que
                      ficou vazio — e mostrar só `source · campaign` escondia
                      exatamente isso. A ordem é a da árvore da Meta:
                      campanha › conjunto (utm_term) › anúncio (utm_content).
                    */}
                    {origem(linha).map((u) => (
                      <span key={u} className="truncate">
                        {u}
                      </span>
                    ))}
                    {/*
                      Venda órfã: conta na receita e NÃO aparece no ROAS por
                      campanha. É a linha que explica o número que não fecha.
                    */}
                    {linha.matchMethod === 'nenhum' && (
                      <span className="text-warning">sem atribuição</span>
                    )}
                    {linha.desfeita && <span>desfeita nos destinos</span>}
                    {linha.status === 'aprovada' && !linha.enviada && (
                      <span className="text-warning">ainda não enviada</span>
                    )}
                  </span>
                </div>

                <span className="flex items-center gap-2 sm:justify-end">
                  <Badge variant={TOM[linha.status]}>{linha.status}</Badge>
                  <span data-slot="metric" className="text-sm font-semibold">
                    {linha.valor === null ? '—' : moeda(linha.valor, simbolo(linha.moeda))}
                  </span>
                </span>

                <span className="text-muted-foreground tabular font-mono text-xs whitespace-nowrap">
                  <Quando iso={linha.criadaEm} />
                </span>
              </div>
            ))}
          </div>
        )}

        {ultimaPagina > 0 && (
          <div className="border-border/60 flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
            <span className="text-muted-foreground tabular text-xs">
              Página {inteiro(filtro.pagina + 1)} de {inteiro(ultimaPagina + 1)}
            </span>
            <div className="flex gap-2">
              {filtro.pagina > 0 && (
                <Link
                  href={link({
                    ...(filtro.status ? { status: filtro.status } : {}),
                    pagina: String(filtro.pagina - 1),
                  })}
                  className="ring-border hover:bg-muted/60 flex h-9 items-center rounded-md px-3 text-sm ring-1"
                >
                  Anterior
                </Link>
              )}
              {filtro.pagina < ultimaPagina && (
                <Link
                  href={link({
                    ...(filtro.status ? { status: filtro.status } : {}),
                    pagina: String(filtro.pagina + 1),
                  })}
                  className="ring-border hover:bg-muted/60 flex h-9 items-center rounded-md px-3 text-sm ring-1"
                >
                  Próxima
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** A moeda é do gateway, não nossa: a Pagou opera em MXN também. */
function simbolo(moedaIso: string): string {
  return { BRL: 'R$', USD: 'US$', EUR: '€', MXN: 'MX$' }[moedaIso] ?? moedaIso;
}
