'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

import { Quando } from '@/components/dash/quando';
import { Badge } from '@/components/ui/badge';
import type { LinhaEvento, PayloadDoEvento } from '@/lib/painel/eventos';

import { carregarPayloadDoEvento } from '../actions';

/**
 * A lista de eventos capturados.
 *
 * Uma linha por evento, e o payload abre sob demanda — os quatro jsonb são
 * grandes demais para virem na listagem.
 *
 * Sem `<table>`: no celular a tabela vira barra de rolagem horizontal, e a
 * regra do projeto é cartão empilhado abaixo de `sm`. Com grid o mesmo
 * markup faz as duas coisas.
 */
export function TabelaEventos({ linhas }: { linhas: LinhaEvento[] }) {
  if (linhas.length === 0) {
    return (
      <p className="text-muted-foreground border-border/60 border-t px-4 py-8 text-center text-sm sm:px-5">
        Nenhum evento neste período com estes filtros.
      </p>
    );
  }

  return (
    <div className="border-border/60 border-t">
      {linhas.map((linha) => (
        <LinhaDoEvento key={linha.id} linha={linha} />
      ))}
    </div>
  );
}

function LinhaDoEvento({ linha }: { linha: LinhaEvento }) {
  const [aberto, setAberto] = React.useState(false);
  const [carregando, iniciar] = React.useTransition();
  const [payload, setPayload] = React.useState<PayloadDoEvento | null>(null);

  function alternar() {
    const abrindo = !aberto;
    setAberto(abrindo);
    // Busca uma vez só: reabrir a mesma linha não volta ao banco.
    if (abrindo && payload === null) {
      iniciar(async () => {
        setPayload(await carregarPayloadDoEvento(linha.id));
      });
    }
  }

  return (
    <div className="border-border/60 border-b last:border-0">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="hover:bg-muted/40 flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors sm:px-5"
      >
        {aberto ? (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        )}

        {/*
          Três colunas com o MEIO encolhível (`minmax(0,auto)`): com `auto`
          puro uma campanha de quarenta caracteres empurrava o horário para
          o lado e os três viravam uma linha corrida. O `gap-x-6` separa o
          horário do resto sem gastar um divisor, que seria tinta sem dado.
        */}
        <div className="grid min-w-0 flex-1 gap-x-6 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] sm:items-center">
          <span className="truncate text-sm font-medium">{linha.nome}</span>

          <span className="text-muted-foreground flex min-w-0 items-center gap-3 text-xs sm:justify-end">
            {linha.trckUserId && (
              <span className="truncate font-mono">
                {linha.trckUserId.slice(0, 12)}…
              </span>
            )}
            {linha.utmSource && (
              <span className="truncate">
                {linha.utmSource}
                {linha.utmCampaign ? ` · ${linha.utmCampaign}` : ''}
              </span>
            )}
            {linha.cidade && <span className="truncate">{linha.cidade}</span>}
          </span>

          <span className="text-muted-foreground tabular font-mono text-xs whitespace-nowrap">
            <Quando iso={linha.criadoEm} />
          </span>
        </div>
      </button>

      {aberto && (
        <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
          <Identificacao linha={linha} />

          {carregando && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Buscando o payload…
            </p>
          )}

          {!carregando && payload?.purgado === true && (
            <p className="text-muted-foreground text-sm">
              Os campos pesados desta linha foram <strong>zerados pela
              retenção</strong> — e não é falha de envio. Data, evento, UTMs e
              geo continuam aqui; o payload e as respostas saem depois de 14
              dias para a tabela não crescer sem limite.
            </p>
          )}

          {!carregando && payload !== null && !payload.purgado && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Bloco titulo="Enviado à Meta" valor={payload.payloadMeta} />
              <Bloco
                titulo="Resposta da Meta"
                valor={payload.respostaMeta}
                // É aqui que se descobre o evento que a Meta ACEITOU e
                // descartou: 200 com `events_received: 0`.
                nota="200 com events_received: 0 é falha, não sucesso."
              />
              <Bloco titulo="Enviado ao GA4" valor={payload.payloadGa4} />
              <Bloco titulo="Resposta do GA4" valor={payload.respostaGa4} />
            </div>
          )}

          {!carregando && payload === null && (
            <p className="text-muted-foreground text-sm">
              Não consegui ler o payload desta linha.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Identificacao({ linha }: { linha: LinhaEvento }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
      <span>
        <span className="text-muted-foreground">event_id: </span>
        <span className="break-all">{linha.eventId}</span>
      </span>
      {linha.trckUserId && (
        <span>
          <span className="text-muted-foreground">trck_user_id: </span>
          <span className="break-all">{linha.trckUserId}</span>
        </span>
      )}
      {linha.url && (
        <span className="min-w-0">
          <span className="text-muted-foreground">url: </span>
          <span className="break-all">{linha.url}</span>
        </span>
      )}
      {linha.pais && (
        <Badge variant="default">
          {linha.pais}
          {linha.cidade ? ` · ${linha.cidade}` : ''}
        </Badge>
      )}
    </div>
  );
}

function Bloco({
  titulo,
  valor,
  nota,
}: {
  titulo: string;
  valor: unknown;
  nota?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-muted-foreground text-xs font-semibold">{titulo}</p>
      {valor === null || valor === undefined ? (
        <p className="text-muted-foreground text-xs">
          {/* Nada enviado é uma resposta: o GA4 não entra no /api/event de
              propósito, porque o Measurement Protocol não deduplica. */}
          Nada enviado.
        </p>
      ) : (
        <>
          <pre className="bg-muted/40 ring-border max-h-72 overflow-auto rounded-md px-3 py-2 font-mono text-xs ring-1">
            {JSON.stringify(valor, null, 2)}
          </pre>
          {nota && <p className="text-muted-foreground text-xs">{nota}</p>}
        </>
      )}
    </div>
  );
}
