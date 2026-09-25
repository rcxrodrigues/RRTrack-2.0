import { MetricCard } from '@/components/dash/metric-card';
import { ListaRanqueada } from '@/components/dash/lista-ranqueada';
import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { Card } from '@/components/ui/card';
import { inteiro, moeda, percentual, razao } from '@/lib/formato';
import { buscarGeo } from '@/lib/painel/consultas';
import { intervaloDe, lerPeriodo } from '@/lib/painel/periodo';
import { carregarConfiguracao } from '@/lib/settings';

export const metadata = { title: 'Geo' };

export const dynamic = 'force-dynamic';

/**
 * De onde vem a visita e de onde vem o dinheiro.
 *
 * **Sem mapa, e a escolha é deliberada.** Um mapa colorido mostra
 * concentração e nada mais: comparar dois tons de azul é o pior jeito de
 * comparar dois números, e a própria skill de dataviz lista escolha
 * coroplética acima de três séries como anti-padrão. O que decide frete,
 * fraude e corte de campanha é o NÚMERO por região — e a conversão por
 * região, que num mapa não cabe.
 *
 * Se um dia o mapa entrar, entra AO LADO da tabela, não no lugar dela.
 */
export default async function GeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { periodo: bruto } = await searchParams;
  const periodo = lerPeriodo(bruto);

  const { settings } = await carregarConfiguracao();
  const intervalo = intervaloDe(periodo, settings.timezone);

  const linhas = await buscarGeo(intervalo);

  const visitantes = linhas.reduce((soma, l) => soma + l.visitantes, 0);
  const compras = linhas.reduce((soma, l) => soma + l.aprovadas, 0);
  const receita = linhas.reduce((soma, l) => soma + l.receita, 0);

  const paises = new Set(linhas.map((l) => l.pais));

  /*
   * Agrupa por país somando as regiões — a consulta devolve o par, porque é
   * o par que serve à tabela de regiões.
   */
  const porPais = new Map<string, { visitantes: number; aprovadas: number; receita: number }>();
  for (const l of linhas) {
    const atual = porPais.get(l.pais) ?? { visitantes: 0, aprovadas: 0, receita: 0 };
    porPais.set(l.pais, {
      visitantes: atual.visitantes + l.visitantes,
      aprovadas: atual.aprovadas + l.aprovadas,
      receita: atual.receita + l.receita,
    });
  }

  const regioesComVenda = linhas.filter((l) => l.aprovadas > 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">Geo</h2>
        <SeletorPeriodo atual={periodo} />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          label="Países"
          value={paises.size > 0 ? inteiro(paises.size) : null}
        />
        <MetricCard
          label="Regiões"
          value={linhas.length > 0 ? inteiro(linhas.length) : null}
          accent="cyan"
        />
        <MetricCard
          label="Com venda"
          value={linhas.length > 0 ? inteiro(regioesComVenda.length) : null}
          accent="amber"
          hint={
            linhas.length > 0
              ? `de ${inteiro(linhas.length)} regiões`
              : undefined
          }
        />
        <MetricCard
          label="Receita"
          value={compras > 0 ? moeda(receita) : null}
          accent="muted"
          hint={`${inteiro(visitantes)} visitantes`}
        />
      </section>

      {linhas.length === 0 ? (
        <Card className="gap-2 p-4 sm:p-5">
          <h3 className="text-sm font-semibold tracking-tight">Sem geo ainda</h3>
          <p className="text-muted-foreground text-sm">
            O geo vem dos cabeçalhos da Vercel ou do Cloudflare, na captura.
            Se nenhuma visita chegou no período, não há de onde tirar.
          </p>
          <p className="text-muted-foreground text-sm">
            <strong>Se chegou visita e o geo está vazio</strong>, o motivo
            provável é o proxy do Cloudflare ligado (nuvem laranja) no
            registro do painel: aí a Vercel vê o IP do Cloudflare e os
            cabeçalhos <code>x-vercel-ip-*</code> deixam de valer. O
            recomendado é <strong>DNS only</strong> nesse registro — e não é
            só o mapa que sofre, é o IP que vai para a Conversions API.
          </p>
        </Card>
      ) : (
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
              itens={linhas
                .toSorted((a, b) => b.receita - a.receita)
                .map((l) => ({
                  id: `${l.pais}-${l.regiao ?? ''}`,
                  rotulo: nomeDaRegiao(l.pais, l.regiao),
                  valor: l.receita,
                  nota: `${inteiro(l.aprovadas)} vendas`,
                }))}
              formatar={(v) => moeda(v)}
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
                .map((l) => {
                  const taxa = razao(l.aprovadas, l.visitantes);
                  return {
                    id: `${l.pais}-${l.regiao ?? ''}`,
                    rotulo: nomeDaRegiao(l.pais, l.regiao),
                    valor: l.visitantes,
                    nota: taxa === null ? undefined : percentual(taxa, 1),
                  };
                })}
            />
          </Card>
        </div>
      )}

      {porPais.size > 1 && (
        <Card className="gap-4 p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">Países</h3>
            <p className="text-muted-foreground text-xs">
              Mais de um país no período. Se a oferta é de um só, o resto pode
              ser bot, VPN ou tráfego que a campanha não deveria estar
              comprando.
            </p>
          </div>
          <ListaRanqueada
            itens={[...porPais.entries()]
              .toSorted((a, b) => b[1].visitantes - a[1].visitantes)
              .map(([pais, dados]) => {
                const taxa = razao(dados.aprovadas, dados.visitantes);
                return {
                  id: pais,
                  rotulo: pais,
                  valor: dados.visitantes,
                  nota:
                    dados.aprovadas > 0
                      ? `${moeda(dados.receita)} · ${taxa === null ? '—' : percentual(taxa, 1)}`
                      : 'sem venda',
                };
              })}
            limite={12}
          />
        </Card>
      )}
    </div>
  );
}

/**
 * `BR` + `SP` → `SP · BR`. A região vem primeiro porque é ela que muda.
 *
 * A Vercel manda a região já sem o prefixo do país; o Cloudflare manda só o
 * país. Quando não há região, o país sozinho é a resposta honesta.
 */
function nomeDaRegiao(pais: string, regiao: string | null): string {
  return regiao ? `${regiao} · ${pais}` : pais;
}
