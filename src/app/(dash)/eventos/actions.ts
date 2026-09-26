'use server';

import { revalidatePath } from 'next/cache';

import {
  buscarCorpoDoWebhook,
  buscarPayload,
  carregarVisitante,
  type CorpoDoWebhook,
  type PayloadDoEvento,
  type Visitante,
} from '@/lib/painel/eventos';
import { carregarConfiguracao } from '@/lib/settings';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { usuarioAtual } from '@/lib/supabase/server';
import { lerWebhook } from '@/lib/webhooks';
import { concluirCompra, gravarCompra } from '@/lib/webhooks/processar';

export type ResultadoReprocesso = {
  ok: boolean;
  mensagem: string;
};

/**
 * Reprocessa um webhook que já está guardado.
 *
 * Existe para o caso que se repete: o payload chega de um checkout cujo
 * adaptador ainda não foi escrito, leva 202, e fica parado em
 * `webhooks_recebidos`. Quando o adaptador nasce, sem isto a única saída
 * seria pedir ao gateway que reenviasse — e a Appmax descarta depois de
 * quatro tentativas, a venda não volta nunca mais.
 *
 * Roda o MESMO caminho do webhook de verdade (`processar.ts`), não uma cópia:
 * a venda reprocessada tem de sair idêntica à que teria chegado sozinha.
 *
 * Reenviar para a Meta não é risco: `dispararCompra` olha o `sent_at` antes
 * de qualquer coisa e sai calado se a venda já foi. Reprocessar duas vezes a
 * mesma linha dá o mesmo resultado que reprocessar uma.
 */
export async function reprocessarWebhook(id: string): Promise<ResultadoReprocesso> {
  // Server Action é um endpoint HTTP como outro qualquer: o botão só
  // aparecer na tela protegida não impede ninguém de chamá-la direto.
  if (!(await usuarioAtual())) {
    return { ok: false, mensagem: 'Sessão expirada. Entre de novo.' };
  }

  const supabase = criarClienteAdmin();

  const { data, error } = await supabase
    .from('webhooks_recebidos')
    .select('corpo')
    .eq('id', id)
    .returns<{ corpo: unknown }[]>()
    .maybeSingle();

  if (error) {
    console.error('[eventos] falha ao ler o webhook guardado:', error.message);
    return { ok: false, mensagem: 'Não consegui ler o webhook guardado.' };
  }

  if (!data) {
    return { ok: false, mensagem: 'Esse webhook não está mais no banco.' };
  }

  if (data.corpo === null) {
    // Guardamos o texto cru quando o corpo não era JSON — e o que não é JSON
    // nenhum adaptador vai ler. Não há o que reprocessar.
    return { ok: false, mensagem: 'O corpo não era JSON válido; não há o que reprocessar.' };
  }

  const { settings } = await carregarConfiguracao();
  const leitura = lerWebhook(data.corpo, {
    statusPorAlias: settings.statusPorAlias,
  });

  if (leitura.tipo === 'desconhecido') {
    return {
      ok: false,
      mensagem: 'Nenhum adaptador reconhece esse formato ainda.',
    };
  }

  if (leitura.tipo === 'indeciso') {
    // O motivo já diz o que cadastrar. Regravado porque o cadastro pode
    // ter mudado desde a última tentativa — e um motivo velho na tela
    // mandaria a pessoa procurar o que já foi resolvido.
    await marcar(id, leitura.adaptador, null, leitura.motivo);
    revalidatePath('/eventos');
    return { ok: false, mensagem: leitura.motivo };
  }

  if (leitura.tipo === 'ignorado') {
    // Reconhecido agora, mas o evento não é venda. Vale gravar quem
    // reconheceu: o badge deixa de dizer "não reconhecido", que é a
    // pergunta que essa tela responde.
    await marcar(id, leitura.adaptador, null, null);
    revalidatePath('/eventos');
    return {
      ok: true,
      mensagem: `Lido pelo adaptador ${leitura.adaptador} — mas o evento não é de venda.`,
    };
  }

  const { compra } = leitura;

  try {
    await gravarCompra(compra, data.corpo);
  } catch (erro) {
    console.error(
      '[eventos] falha ao gravar a compra reprocessada:',
      erro instanceof Error ? erro.message : erro,
    );
    return { ok: false, mensagem: 'Não consegui gravar a compra.' };
  }

  // Em série e DENTRO da action, não em `after()`: aqui quem espera é uma
  // pessoa olhando a tela, não um gateway com cinco segundos de paciência.
  // Ela clicou para saber se funcionou — a resposta tem de ser o resultado.
  await concluirCompra(compra);
  await marcar(id, leitura.adaptador, compra.transactionId, null);

  revalidatePath('/eventos');
  revalidatePath('/faturamento');

  return {
    ok: true,
    mensagem: `Venda ${compra.transactionId} reprocessada por ${leitura.adaptador}.`,
  };
}

/** Anota na linha guardada quem soube ler, para o badge deixar de mentir. */
async function marcar(
  id: string,
  adaptador: string,
  transactionId: string | null,
  motivo: string | null,
): Promise<void> {
  const { error } = await criarClienteAdmin()
    .from('webhooks_recebidos')
    .update({ adaptador, transaction_id: transactionId, motivo })
    .eq('id', id);

  if (error) {
    console.error('[eventos] falha ao marcar o adaptador:', error.message);
  }
}

/**
 * Os payloads de um evento, sob demanda.
 *
 * Buscados só quando a linha abre: `payload_meta`, `response_meta`,
 * `payload_ga4` e `response_ga4` são jsonb grandes, e cinquenta linhas com os
 * quatro dariam megabytes numa listagem que mostra vinte campos.
 */
export async function carregarPayloadDoEvento(
  id: string,
): Promise<PayloadDoEvento | null> {
  // Server Action é endpoint HTTP: o botão só existir na tela protegida não
  // impede ninguém de chamá-la direto. E aqui sai payload com dado pessoal.
  if (!(await usuarioAtual())) return null;

  return buscarPayload(id);
}

/**
 * O visitante de uma linha de evento, com o histórico dele.
 *
 * Passa pelo cliente do USUÁRIO, não pelo `service_role`: as duas tabelas têm
 * policy de select para `authenticated`, e é só isso que a gaveta precisa.
 * Usar o admin aqui seria dar ao painel um caminho que ignora RLS para
 * responder uma pergunta que a RLS já responde.
 */
export async function carregarVisitanteDoEvento(
  trckUserId: string,
): Promise<Visitante | null> {
  await usuarioAtual();
  return carregarVisitante(trckUserId);
}

/**
 * O corpo de um webhook guardado, sob demanda.
 *
 * Gêmea da `carregarPayloadDoEvento`, e pela mesma razão: o payload de um
 * pedido tem o cliente inteiro e passa de dez quilobytes. Cinquenta deles
 * viajavam a cada abertura da aba de Eventos com as linhas todas FECHADAS.
 */
export async function carregarCorpoDoWebhook(
  id: string,
): Promise<CorpoDoWebhook | null> {
  // Server Action é endpoint HTTP: a linha só existir na tela protegida não
  // impede ninguém de chamá-la direto. E aqui sai dado pessoal do comprador.
  if (!(await usuarioAtual())) return null;

  return buscarCorpoDoWebhook(id);
}
