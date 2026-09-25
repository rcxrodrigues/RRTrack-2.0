import { ehObjeto } from '@/lib/json';

/**
 * O que separa a Yampi da Adoorei — e por que isto mora num arquivo só.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ As duas mandam `{event, time, merchant, resource}` com eventos `order.*` │
 * │ e `cart.*`. Um adaptador engoliria o payload do outro e leria tudo       │
 * │ errado: valor num campo que não existe, cliente vazio, status que não    │
 * │ bate.                                                                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O que os distingue é o EMBRULHO: a Yampi devolve toda relação como
 * `{data: …}` — `status.data`, `customer.data`, `items.data`,
 * `metadata.data`. Na Adoorei `status` é texto puro e `customer` é objeto
 * plano.
 *
 * A checagem olhava só `status`, e isso tinha um furo: a lista real de
 * eventos da Yampi (confirmada em 25/09/2026) inclui `cart.reminder`,
 * `customer.created`, `product.*` e `cashback.expiring` — e um carrinho
 * abandonado pode não ter `status` nenhum. Sem status, o teste não rejeitava,
 * e a Adoorei reivindicava um payload da Yampi. Não escrevia dado errado
 * (o `cart.` é ignorado dos dois lados), mas o painel mostrava o adaptador
 * errado — e a próxima relação que a Yampi acrescentar poderia piorar isso.
 *
 * Olhar CINCO relações em vez de uma resolve: basta que qualquer uma venha
 * embrulhada. Mora aqui, e não duplicado nos dois adaptadores, porque uma
 * cópia que divergisse quebraria a separação em silêncio.
 */

/** As relações que a Yampi embrulha. Cresce quando ela acrescentar outra. */
const RELACOES = ['status', 'customer', 'items', 'metadata', 'transactions'] as const;

/** `true` quando o `resource` tem a cara da Yampi. */
export function pareceYampi(corpo: unknown): boolean {
  if (!ehObjeto(corpo)) return false;

  const recurso = corpo.resource;
  if (!ehObjeto(recurso)) return false;

  return RELACOES.some((chave) => {
    const campo = recurso[chave];
    return ehObjeto(campo) && 'data' in campo;
  });
}
