/**
 * CORS por allowlist, para os endpoints públicos de captura.
 *
 * A allowlist vem da tabela `settings`, configurada pelo painel. Não existe
 * modo "libera geral": sem origem cadastrada, nada passa. Um endpoint de
 * captura com `Access-Control-Allow-Origin: *` deixaria qualquer site do
 * mundo gravar eventos no seu banco.
 */

/** Compara origem por origem, sem tolerar subdomínio por acidente. */
/**
 * Reduz a URL à sua origem canônica.
 *
 * "https://site.com/" e "https://site.com" são a mesma origem, mas comparação
 * de texto crua diria que não.
 */
function normalizarOrigem(url: string): string | null {
  try {
    return new URL(url.trim()).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function origemPermitida(
  origem: string | null,
  permitidas: readonly string[],
): boolean {
  if (!origem || permitidas.length === 0) return false;

  const alvo = normalizarOrigem(origem);
  if (!alvo) return false;

  return permitidas.some((p) => normalizarOrigem(p) === alvo);
}

/**
 * Os cabeçalhos de resposta para uma origem autorizada.
 *
 * `Vary: Origin` é obrigatório: sem ele, um CDN pode guardar a resposta
 * liberada para um site e servi-la a outro — ou, pior, guardar a negada e
 * servi-la a quem tinha permissão.
 */
export function cabecalhosCors(origem: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem,
    // O cookie _trck precisa viajar; sem isto o navegador não o envia.
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
