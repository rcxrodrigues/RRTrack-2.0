import 'server-only';

import { buscarInsights } from '@/lib/meta/insights';
import type { Intervalo } from '@/lib/painel/periodo';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * O gasto de mídia do período, somando todas as contas de anúncio ativas.
 *
 * A visão geral precisa dele para mostrar ROAS, e ROAS é a razão de o painel
 * existir: receita sem gasto ao lado é faturamento, não retorno.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SEM CONTA CADASTRADA O GASTO É `null`, NUNCA ZERO.                       │
 * │                                                                          │
 * │ Zero afirmaria que não se gastou nada — e com receita em cima daria um   │
 * │ ROAS infinito, ou `0.00×` se a conta fosse feita ao contrário. Os dois   │
 * │ são números na tela onde a resposta certa é "não sei, ninguém cadastrou  │
 * │ a conta". É a mesma regra do `—` do resto do painel, no lugar onde ela   │
 * │ vale dinheiro.                                                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Reaproveita `buscarInsights`, então herda as três travas da Meta: cache de
 * 15 minutos, fila serial por conta e teto de 25% da pontuação. Abrir a visão
 * geral não custa cota nova enquanto o cache vale.
 */

export type GastoDoPeriodo = {
  /** `null` quando não há conta de anúncio ativa — ver o aviso acima. */
  total: number | null;
  /** Quantas contas entraram na soma. */
  contas: number;
  /** O que impediu de buscar, quando impediu. */
  aviso: string | null;
};

type Conta = { id: string; ad_account_id: string };

export async function buscarGastoDoPeriodo(
  intervalo: Intervalo,
): Promise<GastoDoPeriodo> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from('meta_ad_accounts')
    .select('id, ad_account_id')
    .eq('is_active', true)
    .returns<Conta[]>();

  const contas = data ?? [];
  if (contas.length === 0) {
    return { total: null, contas: 0, aviso: null };
  }

  /*
   * `allSettled`, nunca `all`: uma conta com token vencido não pode apagar o
   * gasto das outras. É a mesma razão do fan-out dos destinos — com `all`, a
   * falha de uma vira ausência de todas, e a tela mostraria menos gasto do
   * que houve, inflando o ROAS.
   */
  const resultados = await Promise.allSettled(
    contas.map(async (c) =>
      buscarInsights({
        contaId: c.id,
        adAccountId: c.ad_account_id,
        nivel: 'campaign',
        de: intervalo.de,
        ate: intervalo.ate,
        fuso: intervalo.fuso,
      }),
    ),
  );

  let total = 0;
  let falharam = 0;
  const avisos: string[] = [];

  for (const r of resultados) {
    if (r.status !== 'fulfilled') {
      falharam += 1;
      continue;
    }
    for (const linha of r.value.linhas) total += linha.gasto;
    if (r.value.aviso) avisos.push(r.value.aviso);
  }

  /*
   * Se TODAS falharam, o total não é zero — é desconhecido. Somar zero aqui
   * seria afirmar que não se gastou nada num dia em que a Meta estava fora.
   */
  if (falharam === contas.length) {
    return {
      total: null,
      contas: contas.length,
      aviso: 'Não consegui ler o gasto de nenhuma conta de anúncio.',
    };
  }

  return {
    total,
    contas: contas.length - falharam,
    aviso:
      falharam > 0
        ? `${String(falharam)} de ${String(contas.length)} contas de anúncio não responderam — o gasto abaixo está incompleto.`
        : (avisos[0] ?? null),
  };
}
