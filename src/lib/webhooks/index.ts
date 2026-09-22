import { adoorei } from '@/lib/webhooks/adoorei';
import { appmax } from '@/lib/webhooks/appmax';
import { pagou } from '@/lib/webhooks/pagou';
import { yampi } from '@/lib/webhooks/yampi';
import { zedy } from '@/lib/webhooks/zedy';
import type { Adaptador, CompraNormalizada } from '@/lib/webhooks/tipos';

export * from '@/lib/webhooks/tipos';

/**
 * Os gateways que sabemos ler.
 *
 * A ordem importa quando dois formatos se parecem: o primeiro que reconhecer
 * fica com o payload. A Yampi vem ANTES da Adoorei de propósito — as duas
 * usam `{event, time, merchant, resource}` com eventos `order.*`, e o que
 * separa é o embrulho `.data` da Yampi, que o `reconhece` dela exige. Adaptador novo entra aqui e em mais lugar nenhum.
 */
export const ADAPTADORES: readonly Adaptador[] = [appmax, pagou, yampi, adoorei, zedy];

export type Leitura =
  | { tipo: 'venda'; adaptador: string; compra: CompraNormalizada }
  /** Formato reconhecido, evento que não interessa ao faturamento. */
  | { tipo: 'ignorado'; adaptador: string }
  /** Nenhum adaptador reconheceu — gateway novo, ou payload corrompido. */
  | { tipo: 'desconhecido' };

/**
 * Descobre de quem é o payload e traduz.
 *
 * O reconhecimento é pelo FORMATO, não por configuração no painel: um
 * endpoint só recebe todos os gateways, e pedir para alguém declarar qual é
 * qual seria mais uma coisa para errar às três da manhã.
 */
export function lerWebhook(corpo: unknown): Leitura {
  for (const adaptador of ADAPTADORES) {
    if (!adaptador.reconhece(corpo)) continue;

    const compra = adaptador.normalizar(corpo);
    return compra
      ? { tipo: 'venda', adaptador: adaptador.nome, compra }
      : { tipo: 'ignorado', adaptador: adaptador.nome };
  }
  return { tipo: 'desconhecido' };
}
