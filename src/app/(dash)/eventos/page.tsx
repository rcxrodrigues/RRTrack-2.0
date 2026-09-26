import Link from 'next/link';

import { SeletorPeriodo } from '@/components/dash/seletor-periodo';
import { Card } from '@/components/ui/card';
import { inteiro } from '@/lib/formato';
import { buscarEventosPorTipo } from '@/lib/painel/consultas';
import { buscarEventos, lerFiltro, POR_PAGINA } from '@/lib/painel/eventos';
import { intervaloDe, lerPeriodo } from '@/lib/painel/periodo';
import { carregarConfiguracao } from '@/lib/settings';
import { criarClienteServidor } from '@/lib/supabase/server';

import { TabelaEventos } from './_components/tabela-eventos';
import {
  WebhookRecebidoItem,
  type WebhookRecebido,
} from './_components/webhook-recebido';

export const metadata = { title: 'Eventos' };

/** Sempre fresco: a razão de abrir esta tela é ver o que acabou de chegar. */
export const dynamic = 'force-dynamic';

/**
 * Os webhooks que chegaram, reconhecidos ou não.
 *
 * A leitura usa o cliente do USUÁRIO, não o service_role — a tabela tem
 * policy de select para `authenticated`, e é só isso que ela precisa.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SEM `corpo`, `corpo_texto` NEM `headers`, DE PROPÓSITO.                │
 * │                                                                        │
 * │ São os três campos pesados: `corpo` é o pedido inteiro do gateway —    │
 * │ cliente, itens, endereço — e passa de dez quilobytes com folga.        │
 * │ Cinquenta linhas os traziam todos no payload do RSC **com todas as    │
 * │ linhas fechadas**, em toda abertura da aba: centenas de quilobytes    │
 * │ para desenhar cinquenta badges e cinquenta datas.                     │
 * │                                                                        │
 * │ Quem abre a linha busca o corpo dela pela Server Action                │
 * │ `carregarCorpoDoWebhook`. É a mesma regra que `events_log` já seguia   │
 * │ com `buscarPayload`; esta lista tinha ficado de fora.                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
async function carregarWebhooks(): Promise<WebhookRecebido[]> {
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from('webhooks_recebidos')
    .select('id, adaptador, transaction_id, motivo, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<WebhookRecebido[]>();

  return data ?? [];
}

export default async function EventosPage({
  searchParams,
}: {
  // No Next 16 `searchParams` é uma Promise — ver node_modules/next/dist/docs.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const periodo = lerPeriodo(params.periodo);
  const filtro = lerFiltro(params);

  const { settings } = await carregarConfiguracao();
  const intervalo = intervaloDe(periodo, settings.timezone);

  const [{ linhas, total }, tipos, recebidos] = await Promise.all([
    buscarEventos(intervalo, filtro),
    buscarEventosPorTipo(intervalo),
    carregarWebhooks(),
  ]);

  const naoReconhecidos = recebidos.filter((r) => r.adaptador === null).length;
  const naoLidos = recebidos.filter((r) => r.motivo !== null).length;

  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);
  const linkDaPagina = (n: number): string => {
    const q = new URLSearchParams({ periodo });
    if (filtro.nome) q.set('nome', filtro.nome);
    if (filtro.busca) q.set('busca', filtro.busca);
    if (n > 0) q.set('pagina', String(n));
    return `?${q.toString()}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">Eventos</h2>
        <SeletorPeriodo atual={periodo} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight">
              Eventos capturados
            </h3>
            <span className="text-muted-foreground tabular text-xs">
              {inteiro(total)} no período
            </span>
          </div>

          {/*
            Formulário GET, sem JS: os filtros viram query string, o estado
            fica na URL e a tela funciona antes da hidratação. Um filtro é a
            última coisa que deveria depender de JavaScript.
          */}
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="periodo" value={periodo} />

            <select
              name="nome"
              defaultValue={filtro.nome}
              aria-label="Tipo de evento"
              className="bg-input/40 ring-border h-9 min-w-36 rounded-md px-2 text-sm ring-1"
            >
              <option value="">Todos os tipos</option>
              {tipos.map((t) => (
                <option key={t.nome} value={t.nome}>
                  {t.nome} ({inteiro(t.total)})
                </option>
              ))}
            </select>

            <input
              type="search"
              name="busca"
              defaultValue={filtro.busca}
              placeholder="trck_user_id ou event_id"
              aria-label="Buscar por identificador"
              className="bg-input/40 ring-border h-9 min-w-52 flex-1 rounded-md px-3 font-mono text-xs ring-1"
            />

            <button
              type="submit"
              className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium"
            >
              Filtrar
            </button>

            {(filtro.nome || filtro.busca) && (
              <Link
                href={`?periodo=${periodo}`}
                className="text-muted-foreground hover:text-foreground flex h-9 items-center px-2 text-sm"
              >
                Limpar
              </Link>
            )}
          </form>
        </div>

        <TabelaEventos linhas={linhas} />

        {ultimaPagina > 0 && (
          <div className="border-border/60 flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
            <span className="text-muted-foreground tabular text-xs">
              Página {inteiro(filtro.pagina + 1)} de {inteiro(ultimaPagina + 1)}
            </span>
            <div className="flex gap-2">
              {filtro.pagina > 0 && (
                <Link
                  href={linkDaPagina(filtro.pagina - 1)}
                  className="ring-border hover:bg-muted/60 flex h-9 items-center rounded-md px-3 text-sm ring-1"
                >
                  Anterior
                </Link>
              )}
              {filtro.pagina < ultimaPagina && (
                <Link
                  href={linkDaPagina(filtro.pagina + 1)}
                  className="ring-border hover:bg-muted/60 flex h-9 items-center rounded-md px-3 text-sm ring-1"
                >
                  Próxima
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-col gap-1 px-4 pt-4 pb-3 sm:px-5">
          <h3 className="text-sm font-semibold tracking-tight">
            Webhooks recebidos
          </h3>
          <p className="text-muted-foreground text-sm">
            Tudo que chega em <code>/api/webhook/compra</code> é guardado aqui
            antes de qualquer interpretação — reconhecido ou não. É assim que
            se descobre o formato de um checkout novo: aponte o webhook dele
            para cá, faça uma venda, e o payload real aparece nesta lista.
          </p>

          {naoLidos > 0 && (
            <p className="text-destructive-vivid text-sm">
              {naoLidos === 1
                ? '1 payload que eu reconheci e não soube ler.'
                : `${String(naoLidos)} payloads que eu reconheci e não soube ler.`}{' '}
              Abra: a mensagem diz exatamente o que cadastrar. Depois de
              cadastrar, clique em <strong>Reprocessar</strong> — nada se
              perdeu.
            </p>
          )}

          {naoReconhecidos > 0 && (
            <p className="text-warning text-sm">
              {naoReconhecidos === 1
                ? '1 payload que nenhum adaptador reconheceu.'
                : `${String(naoReconhecidos)} payloads que nenhum adaptador reconheceu.`}{' '}
              Abra e me mande o conteúdo — é com ele que o adaptador é escrito.
            </p>
          )}
        </div>

        {recebidos.length === 0 ? (
          <p className="text-muted-foreground border-border/60 border-t px-4 py-8 text-center text-sm sm:px-5">
            Nenhum webhook ainda. Cadastre a URL no painel do checkout e faça
            uma venda de teste.
          </p>
        ) : (
          <div className="border-border/60 border-t">
            {recebidos.map((item) => (
              <WebhookRecebidoItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
