import 'server-only';

import { buscarGastoPorDia } from '@/lib/meta/insights';
import type { Intervalo } from '@/lib/painel/periodo';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * O gasto de mídia dia a dia, somando todas as contas de anúncio ativas.
 *
 * Irmão de `buscarGastoDoPeriodo`, no grão fino: é ele que alimenta a segunda
 * linha do quadro de receita × investido. Herda as mesmas três travas da Meta
 * (cache de 15 min, fila serial por conta, teto de 25% da pontuação), porque
 * passa pelo mesmo `buscarGastoPorDia`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `porDia: null` É "NÃO SEI". LISTA VAZIA É "SEI, E FOI ZERO".              │
 * │                                                                          │
 * │ A distinção é a mesma do `total: null` do cartão de gasto, e aqui ela    │
 * │ vale ainda mais porque o desenho AFIRMA: uma linha reta colada no zero,  │
 * │ atravessando o período inteiro, diz "não gastou nada" com a mesma        │
 * │ convicção com que a linha da receita diz quanto entrou. Sem conta        │
 * │ cadastrada, ou com a Meta fora do ar e nada no cache, a resposta certa   │
 * │ é não desenhar — e dizer por quê.                                        │
 * │                                                                          │
 * │ Zero COM conta cadastrada é outra coisa: a campanha não rodou naquele    │
 * │ dia, e R$ 0,00 é verdade. Esse zero aparece.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type GastoDiario = {
  /**
   * Esparso e por data: o dia sem gasto pode não vir da Meta, e quem fecha o
   * eixo é `alinharPorDia`. `null` quando o gasto é desconhecido.
   */
  porDia: { dia: string; valor: number }[] | null;
  /** Quantas contas entraram na soma. */
  contas: number;
  /** O que atrapalhou, quando atrapalhou. */
  aviso: string | null;
};

type Conta = { id: string; ad_account_id: string };

export async function buscarGastoDiario(
  intervalo: Intervalo,
): Promise<GastoDiario> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from('meta_ad_accounts')
    .select('id, ad_account_id')
    .eq('is_active', true)
    .returns<Conta[]>();

  const contas = data ?? [];
  if (contas.length === 0) {
    return { porDia: null, contas: 0, aviso: null };
  }

  /*
   * `allSettled`, nunca `all`: uma conta com token vencido não pode apagar o
   * gasto das outras — com `all` a falha de uma vira ausência de todas, e o
   * quadro mostraria menos investimento do que houve.
   */
  const resultados = await Promise.allSettled(
    contas.map(async (c) =>
      buscarGastoPorDia({
        contaId: c.id,
        adAccountId: c.ad_account_id,
        de: intervalo.de,
        ate: intervalo.ate,
        fuso: intervalo.fuso,
      }),
    ),
  );

  const porDia: { dia: string; valor: number }[] = [];
  let falharam = 0;
  const avisos: string[] = [];

  for (const r of resultados) {
    if (r.status !== 'fulfilled') {
      falharam += 1;
      continue;
    }
    for (const d of r.value.porDia) porDia.push({ dia: d.dia, valor: d.gasto });
    if (r.value.aviso) avisos.push(r.value.aviso);
  }

  /*
   * Todas falharam → desconhecido, não zero. É o caso em que a Meta está
   * fora do ar: afirmar gasto zero num dia em que se gastou é o erro que
   * mais engana, porque o ROAS ao lado ficaria ótimo.
   */
  if (falharam === contas.length) {
    return {
      porDia: null,
      contas: contas.length,
      aviso: 'Não consegui ler o gasto de nenhuma conta de anúncio.',
    };
  }

  return {
    porDia,
    contas: contas.length - falharam,
    aviso:
      falharam > 0
        ? `${String(falharam)} de ${String(contas.length)} contas de anúncio não responderam — a linha de investido está incompleta.`
        : (avisos[0] ?? null),
  };
}
