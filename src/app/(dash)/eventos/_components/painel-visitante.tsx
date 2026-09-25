'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';

import { Quando } from '@/components/dash/quando';
import { corDoEvento } from '@/lib/painel/cores-evento';
import type {
  EventoDoVisitante,
  PayloadDoEvento,
  Visitante,
} from '@/lib/painel/eventos';

import { carregarPayloadDoEvento } from '../actions';

/**
 * A gaveta do visitante — quem é, de onde veio, e tudo que ele fez.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `.flutuante`, NÃO `.glass`.                                              │
 * │                                                                          │
 * │ Ela abre POR CIMA da tabela. `.glass` é translúcido e a lista de eventos │
 * │ apareceria através do texto — foi assim que o seletor de moeda nasceu    │
 * │ errado. O que flutua sobre texto é opaco, sem exceção.                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * No celular ela ocupa a tela inteira: gaveta de 420px num aparelho de 390
 * seria uma tela com uma beirada inútil do lado.
 */
export function PainelVisitante({
  visitante,
  carregando,
  aoFechar,
}: {
  visitante: Visitante | null;
  carregando: boolean;
  aoFechar: () => void;
}) {
  // Esc fecha. Gaveta que só fecha no X obriga a mirar num alvo de 24px.
  React.useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') aoFechar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => { window.removeEventListener('keydown', aoTeclar); };
  }, [aoFechar]);

  return (
    <>
      {/* O fundo escurece e também fecha ao clique — é o gesto que todo mundo
          tenta primeiro. */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={aoFechar}
        className="fixed inset-0 z-40 bg-black/50"
      />

      <aside
        className="flutuante fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto sm:max-w-[26rem]"
        aria-label="Visitante"
      >
        <div className="border-border/60 bg-inherit sticky top-0 flex items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="text-sm font-semibold tracking-tight">Visitante</h3>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="hover:bg-muted/60 flex size-11 items-center justify-center rounded-md"
          >
            <X className="size-4" />
          </button>
        </div>

        {carregando && (
          <div className="text-muted-foreground flex items-center gap-2 px-4 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Carregando…
          </div>
        )}

        {!carregando && visitante === null && (
          <p className="text-muted-foreground px-4 py-8 text-sm">
            Este evento não tem <code>trck_user_id</code>, ou o visitante não
            foi identificado. O evento é gravado mesmo assim — perder o evento
            por falta de identificação seria pior que guardá-lo órfão.
          </p>
        )}

        {!carregando && visitante && <Conteudo visitante={visitante} />}
      </aside>
    </>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  if (valor === null || valor === undefined || valor === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-muted-foreground shrink-0 text-xs">{rotulo}</span>
      <span className="wrap-anywhere text-right text-xs">{valor}</span>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-border/60 flex flex-col border-b px-4 py-3">
      <h4 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
        {titulo}
      </h4>
      {children}
    </section>
  );
}

function Conteudo({ visitante: v }: { visitante: Visitante }) {
  const nome = [v.primeiroNome, v.sobrenome].filter(Boolean).join(' ');
  const lugar = [v.cidade, v.regiao, v.pais].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col">
      <Secao titulo="Identidade">
        <Campo rotulo="trck_user_id" valor={<code className="font-mono">{v.trckUserId}</code>} />
        <Campo rotulo="Nome" valor={nome} />
        <Campo rotulo="E-mail" valor={v.email} />
        <Campo rotulo="Telefone" valor={v.telefone} />
        <Campo rotulo="Primeira visita" valor={v.criadoEm ? <Quando iso={v.criadoEm} /> : null} />
      </Secao>

      <Secao titulo="Casamento na Meta">
        {/*
          Presença, não valor. O que a tela precisa responder é "a Meta tem com
          quem casar?" — e para isso basta saber se o cookie existe. O valor é
          identificador de rastreio e não tem por que ser copiado para dentro
          de um HTML que não precisa dele.
        */}
        <Campo rotulo="_fbp" valor={v.temFbp ? 'presente' : <span className="text-warning">ausente</span>} />
        <Campo rotulo="_fbc" valor={v.temFbc ? 'presente' : <span className="text-muted-foreground">ausente</span>} />
        <Campo rotulo="ga_client_id" valor={v.gaClientId ? <code className="font-mono">{v.gaClientId}</code> : <span className="text-warning">ausente</span>} />
        {!v.temFbp && (
          <p className="text-warning mt-1 text-xs">
            Sem <code>_fbp</code> a conversão chega à Meta com menos com o que
            casar, e o match cai sem erro nenhum aparecer.
          </p>
        )}
      </Secao>

      <Secao titulo="Origem">
        <Campo rotulo="utm_source" valor={v.utmSource} />
        <Campo rotulo="utm_medium" valor={v.utmMedium} />
        <Campo rotulo="utm_campaign" valor={v.utmCampaign} />
        <Campo rotulo="utm_term (conjunto)" valor={v.utmTerm} />
        <Campo rotulo="utm_content (anúncio)" valor={v.utmContent} />
        <Campo rotulo="Referrer" valor={v.referrer} />
        <Campo rotulo="Entrou por" valor={v.landingUrl} />
        <Campo rotulo="Região" valor={lugar} />
      </Secao>

      <section className="flex flex-col px-4 py-3">
        <h4 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
          Histórico ({v.eventos.length})
        </h4>
        {v.eventos.length === 0 ? (
          <p className="text-muted-foreground py-2 text-xs">Nenhum evento.</p>
        ) : (
          <div className="flex flex-col">
            {v.eventos.map((e) => (
              <EventoDoHistorico key={e.id} evento={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Uma linha do histórico. O payload da Meta abre ao clique. */
function EventoDoHistorico({ evento }: { evento: EventoDoVisitante }) {
  const [aberto, setAberto] = React.useState(false);
  const [carregando, iniciar] = React.useTransition();
  const [payload, setPayload] = React.useState<PayloadDoEvento | null>(null);

  function alternar() {
    const abrindo = !aberto;
    setAberto(abrindo);
    // Busca uma vez só: reabrir a mesma linha não volta ao banco.
    if (abrindo && payload === null) {
      iniciar(async () => { setPayload(await carregarPayloadDoEvento(evento.id)); });
    }
  }

  const utms = [evento.utmCampaign, evento.utmTerm, evento.utmContent]
    .filter(Boolean)
    .join(' › ');

  return (
    <div className="border-border/60 border-b last:border-0">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="hover:bg-muted/40 flex min-h-11 w-full items-center gap-2 py-2 text-left"
      >
        {aberto ? (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: corDoEvento(evento.nome) }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{evento.nome}</span>
          {utms && (
            <span className="text-muted-foreground block truncate text-[0.7rem]">
              {utms}
            </span>
          )}
        </span>
        <span className="text-muted-foreground tabular shrink-0 font-mono text-[0.7rem]">
          <Quando iso={evento.criadoEm} />
        </span>
      </button>

      {aberto && (
        <div className="pb-3 pl-6">
          {carregando && (
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3 animate-spin" /> carregando…
            </span>
          )}

          {/*
            A retenção zera os payloads aos 14 dias e mantém a linha. Sem
            dizer isso, uma caixa vazia pareceria envio que falhou — e alguém
            iria caçar um bug que não existe.
          */}
          {!carregando && evento.purgado && (
            <p className="text-muted-foreground text-xs">
              O payload foi removido pela retenção (14 dias). A linha do evento
              fica — data, UTMs e geo seguem alimentando o painel.
            </p>
          )}

          {!carregando && !evento.purgado && payload && (
            <PayloadDaMeta payload={payload} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Só o que foi para a META.
 *
 * O GA4 fica de fora de propósito — ele se confere no próprio painel do
 * Google, e repetir o JSON aqui dobraria o tamanho da gaveta para mostrar o
 * que ninguém lê por este caminho.
 */
function PayloadDaMeta({ payload }: { payload: PayloadDoEvento }) {
  if (payload.payloadMeta === null && payload.respostaMeta === null) {
    return (
      <p className="text-muted-foreground text-xs">
        Nada foi enviado à Meta neste evento. Confira se há pixel ativo em
        Configuração.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {payload.payloadMeta !== null && (
        <Bloco titulo="Enviado" valor={payload.payloadMeta} />
      )}
      {payload.respostaMeta !== null && (
        <Bloco titulo="Resposta" valor={payload.respostaMeta} />
      )}
    </div>
  );
}

function Bloco({ titulo, valor }: { titulo: string; valor: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[0.7rem] font-semibold">
        {titulo}
      </span>
      <pre className="bg-muted/40 ring-border max-h-64 overflow-auto rounded-md px-2 py-1.5 font-mono text-[0.7rem] ring-1">
        {JSON.stringify(valor, null, 2)}
      </pre>
    </div>
  );
}
