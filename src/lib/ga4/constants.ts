/**
 * Measurement Protocol do GA4.
 *
 * Ao contrário da Graph API da Meta, aqui não há versão na URL — o Google
 * versiona pelo caminho `/mp/` e mantém compatibilidade.
 * https://developers.google.com/analytics/devguides/collection/protocol/ga4
 */
export const GA4_MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect' as const;

/**
 * O endpoint de validação. Responde o que estaria errado no payload SEM
 * registrar o evento — é o que usamos no "Testar conexão", para verificar
 * uma credencial não poluir o relatório de ninguém.
 */
export const GA4_MP_DEBUG_ENDPOINT =
  'https://www.google-analytics.com/debug/mp/collect' as const;
