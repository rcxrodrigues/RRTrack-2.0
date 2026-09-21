/**
 * O identificador do visitante — a espinha dorsal do sistema.
 *
 * Ele nasce na primeira visita, vive num cookie de primeira parte, viaja na
 * URL do checkout e volta no webhook da compra. É o que liga "alguém clicou
 * no anúncio" a "alguém pagou".
 *
 * Formato: 32 caracteres hexadecimais (um UUID v4 sem os hífens). Sem hífen
 * porque ele aparece em URL de checkout e em link de WhatsApp, onde um
 * caractere a menos para codificar é um problema a menos.
 */

export const COOKIE_TRCK = '_trck';

/** Um ano: o ciclo de uma campanha cabe com folga. */
export const VALIDADE_COOKIE_SEGUNDOS = 60 * 60 * 24 * 365;

/** Os nomes que aceitamos na URL, porque cada plataforma chama de um jeito. */
export const PARAMS_TRCK = ['trck_user_id', 'trck', 'trck_id'] as const;

export function gerarTrckUserId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/**
 * Valida o que veio de fora antes de usar como chave.
 *
 * Um identificador vindo da URL é entrada de usuário: sem esta checagem,
 * qualquer texto viraria uma linha em `visitors`.
 */
export function ehTrckUserIdValido(valor: unknown): valor is string {
  return typeof valor === 'string' && /^[0-9a-f]{32}$/.test(valor);
}

/** Aceita também a forma com hífens, normalizando para a nossa. */
export function normalizarTrckUserId(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().toLowerCase().replaceAll('-', '');
  return ehTrckUserIdValido(limpo) ? limpo : null;
}

/**
 * O primeiro identificador válido encontrado na URL.
 *
 * A URL tem precedência sobre o cookie: quando alguém chega pelo link que
 * carrega o `trck_user_id`, esse é o vínculo que interessa — é ele que vai
 * casar com a venda.
 */
export function trckUserIdDaUrl(params: URLSearchParams): string | null {
  for (const nome of PARAMS_TRCK) {
    const achado = normalizarTrckUserId(params.get(nome));
    if (achado) return achado;
  }
  return null;
}
