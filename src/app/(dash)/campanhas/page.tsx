import Link from 'next/link';

import { MetricCard } from '@/components/dash/metric-card';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { Card } from '@/components/ui/card';
import { inteiro, moeda } from '@/lib/formato';
import { buscarInsights } from '@/lib/meta/insights';
import { buscarReceitaPorUtmCompleta } from '@/lib/painel/consultas';
import { montarArvore } from '@/lib/painel/arvore';
import { intervaloDe, lerPeriodo } from '@/lib/painel/periodo';

import { ArvoreCampanhas } from './_components/arvore-campanhas';
import { carregarConfiguracao } from '@/lib/settings';
import { criarClienteServidor } from '@/lib/supabase/server';

export const metadata = { title: 'Campanhas' };

export const dynamic = 'force-dynamic';


type Conta = { id: string; label: string | null; ad_account_id: string };

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const periodo = lerPeriodo(params.periodo);

  const { settings } = await carregarConfiguracao();
  const intervalo = intervaloDe(periodo, settings.timezone);

  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from('meta_ad_accounts')
    .select('id, label, ad_account_id')
    .eq('is_active', true)
    .order('created_at')
    .returns<Conta[]>();

  const contas = data ?? [];
  const pedida = Array.isArray(params.conta) ? params.conta[0] : params.conta;
  const conta = contas.find((c) => c.id === pedida) ?? contas[0];

  if (!conta) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">Campanhas</h2>
        <Card className="gap-2 p-4 sm:p-5">
          <h3 className="text-sm font-semibold tracking-tight">
            Nenhuma conta de anúncio ativa
          </h3>
          <p className="text-muted-foreground text-sm">
            Cadastre em <strong>Configuração → Meta Ads</strong>: o{' '}
            <code>ad_account_id</code> e um token com permissão de leitura. É
            com ele que o gasto entra — a receita já está aqui.
          </p>
        </Card>
      </div>
    );
  }

  /*
   * Os TRÊS níveis, para a árvore existir.
   *
   * São três chamadas onde antes era uma, e isso é deliberado: a hierarquia
   * não dá para deduzir de um nível só — o insight de anúncio traz
   * `adset_id`, não o nome da campanha. As três passam pela MESMA fila
   * serial por conta e pelo mesmo cache de 15 minutos, então não viram três
   * vezes o consumo de cota: viram três leituras que o cache atende juntas
   * enquanto vale.
   */
  const pedir = async (nivel: 'campaign' | 'adset' | 'ad') =>
    buscarInsights({
      contaId: conta.id,
      adAccountId: conta.ad_account_id,
      nivel,
      de: intervalo.de,
      ate: intervalo.ate,
      fuso: intervalo.fuso,
    });

  const [insights, conjuntos, anuncios, receitas] = await Promise.all([
    pedir('campaign'),
    pedir('adset'),
    pedir('ad'),
    buscarReceitaPorUtmCompleta(intervalo),
  ]);

  const { raizes, receitaOrfa, vendasOrfas, utmsSemPar } = montarArvore(
    insights.linhas,
    conjuntos.linhas,
    anuncios.linhas,
    receitas,
  );

  // Os totais vêm do nível da CAMPANHA. Somar a árvore inteira contaria o
  // mesmo gasto três vezes — uma por nível.
  const gasto = raizes.reduce((s, l) => s + l.gasto, 0);
  const receita = raizes.reduce((s, l) => s + l.receita, 0);
  const vendas = raizes.reduce((s, l) => s + l.vendas, 0);
  const receitaDaMeta = raizes.reduce((s, l) => s + l.receitaDaMeta, 0);

  /*
   * Houve venda no período e NENHUMA casou com campanha: o ROAS geral não é
   * zero, é desconhecido — e a ponte da UTM é que está caída. Mostrar
   * `0,00×` na métrica grande diria que a mídia toda não deu retorno.
   */
  const nadaCasou = vendas === 0 && (receitaOrfa > 0 || vendasOrfas > 0);
  const roasGeral = gasto > 0 && !nadaCasou ? receita / gasto : null;
  const cpaGeral = vendas > 0 ? gasto / vendas : null;


  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">Campanhas</h2>
        <SeletorPeriodo atual={periodo} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {contas.length > 1 &&
          contas.map((c) => (
            <Link
              key={c.id}
              href={`?${new URLSearchParams({ periodo, conta: c.id }).toString()}`}
              className={
                c.id === conta.id
                  ? 'bg-primary text-primary-foreground flex h-9 items-center rounded-md px-3 text-sm font-medium'
                  : 'ring-border text-muted-foreground hover:text-foreground flex h-9 items-center rounded-md px-3 text-sm ring-1'
              }
            >
              {c.label ?? c.ad_account_id}
            </Link>
          ))}

      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard label="Gasto" value={gasto > 0 ? moeda(gasto) : null} sentido="menor-melhor" />
        <MetricCard
          label="Receita"
          value={vendas > 0 ? moeda(receita) : null}
          accent="cyan"
          hint={`${inteiro(vendas)} vendas`}
        />
        <MetricCard
          label="ROAS"
          value={roasGeral === null ? null : `${roasGeral.toFixed(2)}×`}
          accent="amber"
          hint={nadaCasou ? 'nenhuma venda casou por UTM' : 'receita ÷ gasto'}
        />
        <MetricCard
          label="CPA"
          value={cpaGeral === null ? null : moeda(cpaGeral)}
          accent="muted"
          sentido="menor-melhor"
        />
      </section>

      {insights.aviso && (
        <Card className="gap-2 p-4 sm:p-5">
          <h3 className="text-sm font-semibold tracking-tight">
            O gasto pode estar incompleto
          </h3>
          <p className="text-muted-foreground text-sm">{insights.aviso}.</p>
        </Card>
      )}

      {/*
        O diagnóstico que faz esta tela valer. UTM que não casa não some: ela
        derruba o ROAS pela metade e faz parecer que a campanha piorou. Aqui
        ela aparece com nome e sobrenome.
      */}
      {(receitaOrfa > 0 || utmsSemPar.length > 0) && (
        <Card className="gap-2 p-4 sm:p-5">
          <h3 className="text-sm font-semibold tracking-tight">
            Receita fora de campanha
          </h3>
          <p className="text-muted-foreground text-sm">
            <strong className="text-warning">{moeda(receitaOrfa)}</strong> em{' '}
            {inteiro(vendasOrfas)}{' '}
            {vendasOrfas === 1 ? 'venda não entrou' : 'vendas não entraram'} em
            campanha nenhuma. O ROAS acima é calculado{' '}
            <strong>sem</strong> esse dinheiro — ele existe, só não dá para
            dizer de onde veio.
          </p>
          {utmsSemPar.length > 0 && (
            <>
              <p className="text-muted-foreground text-sm">
                Estas <code>utm_campaign</code> chegaram e não bateram com
                campanha nenhuma da conta. Quase sempre é a macro do anúncio:
                use <code>{'{{campaign.name}}'}</code> ou{' '}
                <code>{'{{campaign.id}}'}</code> em vez de digitar à mão.
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {utmsSemPar.slice(0, 12).map((utm) => (
                  <li
                    key={utm}
                    className="bg-muted/50 rounded-md px-2 py-0.5 font-mono text-xs"
                  >
                    {utm}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-1 px-4 pt-4 pb-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight">
              Campanhas
            </h3>
            {insights.cacheDe && (
              <span className="text-muted-foreground text-xs">
                gasto do cache — a Meta limita consultas
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            A receita é a <strong>nossa</strong>, casada por UTM. A da Meta
            aparece ao lado quando difere — ela conta a conversão sem descontar
            estorno, porque a Conversions API não tem reversão.
          </p>
          <p className="text-muted-foreground text-xs">
            Clique numa campanha para ver os conjuntos, e num conjunto para
            ver os anúncios. O gasto aparece em cada nível.
          </p>
        </div>

        <ArvoreCampanhas raizes={raizes} />
      </Card>

      {receitaDaMeta > 0 && (
        <p className="text-muted-foreground px-1 text-xs">
          A Meta soma {moeda(receitaDaMeta)} de receita nestas linhas; nós
          contamos {moeda(receita)}. A diferença não é erro: ela não desconta
          estorno e atribui por janela de visualização. O que fecha com o
          caixa é o nosso.
        </p>
      )}
    </div>
  );
}
