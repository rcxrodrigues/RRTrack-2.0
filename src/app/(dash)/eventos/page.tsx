import { Card } from '@/components/ui/card';
import { criarClienteServidor } from '@/lib/supabase/server';
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
 */
async function carregar(): Promise<WebhookRecebido[]> {
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from('webhooks_recebidos')
    .select('id, adaptador, corpo, corpo_texto, headers, transaction_id, motivo, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<WebhookRecebido[]>();

  return data ?? [];
}

export default async function EventosPage() {
  const recebidos = await carregar();
  const naoReconhecidos = recebidos.filter((r) => r.adaptador === null).length;
  // Reconhecido e não lido é pior que não reconhecido: ali o formato é
  // nosso, o evento parecia importar, e falta cadastro — não adaptador.
  const naoLidos = recebidos.filter((r) => r.motivo !== null).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">Eventos</h2>

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
