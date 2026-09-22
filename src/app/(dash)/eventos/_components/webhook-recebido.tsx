'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export type WebhookRecebido = {
  id: string;
  adaptador: string | null;
  corpo: unknown;
  corpo_texto: string | null;
  headers: Record<string, string> | null;
  transaction_id: string | null;
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
 * A data em UTC, derivada do texto ISO sem passar por `Date`.
 *
 * Determinística de propósito: é o que o servidor renderiza. Formatar com
 * `toLocaleString` aqui seria armadilha — o servidor roda em UTC (a Vercel
 * roda) e o navegador no fuso de quem olha, então os dois produziriam textos
 * diferentes para a mesma linha e a hidratação quebraria.
 */
function emUtc(iso: string): string {
  const [data = '', resto = ''] = iso.split('T');
  const [, mes = '', dia = ''] = data.split('-');
  return `${dia}/${mes}, ${resto.slice(0, 8)} UTC`;
}

/**
 * O horário de quem está olhando.
 *
 * Trocado só DEPOIS da montagem: aí o servidor já entregou o texto em UTC,
 * a hidratação casou, e a melhora acontece sem mismatch. Numa tela de
 * depuração o fuso local importa — é ele que bate com o relógio da pessoa
 * que acabou de disparar a venda de teste.
 */
function Quando({ iso }: { iso: string }) {
  // `useSyncExternalStore` existe exatamente para isto: ele aceita um
  // retrato do SERVIDOR e outro do CLIENTE. O servidor entrega UTC, a
  // hidratação casa, e o cliente passa a mostrar o fuso de quem olha — sem
  // `setState` em efeito, que dispara render em cascata.
  const texto = React.useSyncExternalStore(
    // Nunca muda depois de montado: não há a que assinar.
    () => () => {},
    () => formatarLocal(iso),
    () => emUtc(iso),
  );

  return <>{texto}</>;
}

function formatarLocal(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function WebhookRecebidoItem({ item }: { item: WebhookRecebido }) {
  const [aberto, setAberto] = React.useState(false);

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

        {item.adaptador ? (
          <Badge variant="success">{item.adaptador}</Badge>
        ) : (
          /* O caso que interessa olhar: ninguém reconheceu o formato. */
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
          {interessantes.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs font-semibold">
                Cabeçalhos
              </p>
              <div className="bg-muted/40 ring-border overflow-x-auto rounded-md px-3 py-2 ring-1">
                {interessantes.map(([nome, valor]) => (
                  <div key={nome} className="font-mono text-xs">
                    <span className="text-muted-foreground">{nome}: </span>
                    <span className="break-all">{valor}</span>
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
        </div>
      )}
    </div>
  );
}
