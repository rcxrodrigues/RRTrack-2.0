'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Quando } from '@/components/dash/quando';
import { reprocessarWebhook } from '../actions';

export type WebhookRecebido = {
  id: string;
  adaptador: string | null;
  corpo: unknown;
  corpo_texto: string | null;
  headers: Record<string, string> | null;
  transaction_id: string | null;
  /**
   * Por que não virou venda.
   *
   * Preenchido só quando o adaptador RECONHECEU e não soube o que fazer —
   * venda possivelmente perdida. Nota fiscal e afins são ignoradas de
   * propósito e vêm com `motivo` nulo, porque ali não há nada a resolver.
   */
  motivo: string | null;
  created_at: string;
};

/**
 * Cabeçalhos que não dizem nada sobre o gateway e só ocupam espaço.
 *
 * O resto FICA — é neles que se descobre como cada um assina. O header do
 * HMAC da MillionsPay e o `X-Adoorei-hash` aparecem aqui, e é exatamente
 * essa a pergunta que trava dois adaptadores hoje.
 */
const RUIDO = new Set([
  'accept', 'accept-encoding', 'accept-language', 'connection', 'host',
  'cache-control', 'pragma', 'te', 'upgrade-insecure-requests',
]);

/**
 * O motivo vem com os nomes de campo entre crases, porque a mesma string vai
 * para o log. Na tela eles viram `code`: é o nome do campo que diz o que
 * cadastrar, e é o que o olho procura primeiro numa mensagem de quatro linhas.
 * Cru, o crase parece defeito.
 */
function ComCampos({ texto }: { texto: string }) {
  const partes = texto.split('`');
  return (
    <>
      {partes.map((parte, i) =>
        i % 2 === 1 ? (
          <code key={`${String(i)}-${parte}`} className="font-mono text-[0.9em]">
            {parte}
          </code>
        ) : (
          <React.Fragment key={`${String(i)}-${parte}`}>{parte}</React.Fragment>
        ),
      )}
    </>
  );
}

export function WebhookRecebidoItem({ item }: { item: WebhookRecebido }) {
  const [aberto, setAberto] = React.useState(false);
  const [rodando, iniciar] = React.useTransition();

  const interessantes = Object.entries(item.headers ?? {}).filter(
    ([nome]) => !RUIDO.has(nome.toLowerCase()),
  );

  const corpo =
    item.corpo === null
      ? (item.corpo_texto ?? '(vazio)')
      : JSON.stringify(item.corpo, null, 2);

  return (
    <div className="border-border/60 border-b last:border-0">
      <button
        type="button"
        onClick={() => { setAberto((v) => !v); }}
        className="hover:bg-muted/40 flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
        aria-expanded={aberto}
      >
        {aberto ? (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        )}

        {/*
          Três estados, e a diferença entre os dois últimos é dinheiro.

          · verde    — tratado, ou ignorado de propósito
          · amarelo  — ninguém reconheceu o formato: falta adaptador
          · vermelho — RECONHECIDO e não soube ler. Este é o pior: o formato
                       era nosso, o evento parecia importar, e faltou
                       cadastro. Antes ele ficava verde junto com a nota
                       fiscal, e uma venda perdida se escondia atrás da
                       aparência de tratada.
        */}
        {item.motivo ? (
          <Badge variant="destructive">não soube ler</Badge>
        ) : item.adaptador ? (
          <Badge variant="success">{item.adaptador}</Badge>
        ) : (
          <Badge variant="warning">não reconhecido</Badge>
        )}

        <span className="tabular text-muted-foreground font-mono text-xs">
          <Quando iso={item.created_at} />
        </span>

        {item.transaction_id && (
          <span className="text-muted-foreground truncate font-mono text-xs">
            {item.transaction_id}
          </span>
        )}
      </button>

      {aberto && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {item.motivo && (
            <p className="text-destructive-vivid text-sm">
              {item.adaptador}: <ComCampos texto={item.motivo} />
            </p>
          )}
          {interessantes.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs font-semibold">
                Cabeçalhos
              </p>
              <div className="bg-muted/40 ring-border overflow-x-auto rounded-md px-3 py-2 ring-1">
                {interessantes.map(([nome, valor]) => (
                  <div key={nome} className="font-mono text-xs">
                    <span className="text-muted-foreground">{nome}: </span>
                    <span className="wrap-anywhere">{valor}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs font-semibold">
              Corpo {item.corpo === null && '(não era JSON válido)'}
            </p>
            <pre className="bg-muted/40 ring-border max-h-96 overflow-auto rounded-md px-3 py-2 font-mono text-xs ring-1">
              {corpo}
            </pre>
          </div>

          {item.corpo !== null && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rodando}
                onClick={() => {
                  iniciar(async () => {
                    const r = await reprocessarWebhook(item.id);
                    if (r.ok) toast.success(r.mensagem);
                    else toast.error(r.mensagem);
                  });
                }}
              >
                <RefreshCw className={rodando ? 'animate-spin' : undefined} />
                {rodando ? 'Reprocessando…' : 'Reprocessar'}
              </Button>

              <p className="text-muted-foreground text-xs">
                Roda este payload pelos adaptadores de novo. É o que recupera
                uma venda que chegou antes do adaptador existir — o gateway
                não reenvia para sempre.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
