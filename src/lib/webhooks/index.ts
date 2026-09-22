import { adoorei } from '@/lib/webhooks/adoorei';
import { appmax } from '@/lib/webhooks/appmax';
import { pagou } from '@/lib/webhooks/pagou';
import { yampi } from '@/lib/webhooks/yampi';
import { zedy } from '@/lib/webhooks/zedy';
import {
  ehIndeciso,
  type Adaptador,
  type CompraNormalizada,
  type ContextoDoAdaptador,
} from '@/lib/webhooks/tipos';

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
  /**
   * Reconhecido, e o adaptador NÃO soube o que fazer.
   *
   * Separado do `ignorado` de propósito: aquele é normal e é a maioria;
   * este é venda possivelmente perdida e tem de aparecer no painel. Até
   * existir a distinção, os dois ficavam com o mesmo badge verde.
   */
  | { tipo: 'indeciso'; adaptador: string; motivo: string }
  /** Nenhum adaptador reconheceu — gateway novo, ou payload corrompido. */
  | { tipo: 'desconhecido' };

/**
 * Descobre de quem é o payload e traduz.
 *
 * O reconhecimento é pelo FORMATO, não por configuração no painel: um
 * endpoint só recebe todos os gateways, e pedir para alguém declarar qual é
 * qual seria mais uma coisa para errar às três da manhã.
 */
export function lerWebhook(
  corpo: unknown,
  contexto?: ContextoDoAdaptador,
): Leitura {
  for (const adaptador of ADAPTADORES) {
    if (!adaptador.reconhece(corpo)) continue;

    const nome = adaptador.nome;
    const lido = adaptador.normalizar(corpo, contexto);

    if (lido === null) return { tipo: 'ignorado', adaptador: nome };
    if (ehIndeciso(lido)) {
      return { tipo: 'indeciso', adaptador: nome, motivo: lido.motivo };
    }
    return { tipo: 'venda', adaptador: nome, compra: lido };
  }
  return { tipo: 'desconhecido' };
}
