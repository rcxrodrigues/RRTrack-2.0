/**
 * Versão da Graph API da Meta — ÚNICA FONTE DE VERDADE.
 *
 * Para atualizar, troque só a linha abaixo. Nenhum outro arquivo do projeto
 * pode escrever uma versão da Graph API ou montar uma URL da Meta à mão; o
 * teste em `constants.test.ts` faz isso valer.
 *
 * Atual: v26.0, lançada em 29/07/2026.
 * Changelog: https://developers.facebook.com/docs/graph-api/changelog
 * Versionamento: https://developers.facebook.com/docs/graph-api/guides/versioning
 *
 * A Meta lança uma versão a cada ~4-6 meses e cada uma vive cerca de 2 anos.
 * Ao subir de versão, leia o changelog da nova: mudanças de parâmetro da
 * Conversions API e dos Insights costumam vir junto.
 */
export const META_GRAPH_API_VERSION = 'v26.0' as const;

/** Base de toda chamada à Graph API. */
export const META_GRAPH_API_BASE =
  `https://graph.facebook.com/${META_GRAPH_API_VERSION}` as const;

/** Endpoint da Conversions API de um pixel. */
export function metaEventsEndpoint(pixelId: string): string {
  return `${META_GRAPH_API_BASE}/${pixelId}/events`;
}

/** Endpoint de Insights de uma conta de anúncio (aceita com ou sem `act_`). */
export function metaInsightsEndpoint(adAccountId: string): string {
  const id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  return `${META_GRAPH_API_BASE}/${id}/insights`;
}

/** Endpoint de um nó qualquer da Graph API (`/<id>` ou `/<id>/<edge>`). */
export function metaNodeEndpoint(path: string): string {
  return `${META_GRAPH_API_BASE}/${path.replace(/^\/+/, '')}`;
}
