/**
 * Leitura segura de JSON que veio de fora.
 *
 * Resposta de API externa não tem contrato garantido: o campo pode faltar,
 * vir com outro tipo, ou o corpo inteiro pode ser `null`. Estas funções são
 * type predicates de verdade — o compilador estreita o tipo a partir de uma
 * checagem real, em vez de acreditar numa asserção nossa.
 */

export function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** O texto em `chave`, ou `undefined` se não houver um texto ali. */
export function texto(valor: unknown, chave: string): string | undefined {
  if (!ehObjeto(valor)) return undefined;
  const campo = valor[chave];
  return typeof campo === 'string' ? campo : undefined;
}

/** O número em `chave`, ou `undefined`. NaN e Infinity não passam. */
export function numero(valor: unknown, chave: string): number | undefined {
  if (!ehObjeto(valor)) return undefined;
  const campo = valor[chave];
  return typeof campo === 'number' && Number.isFinite(campo) ? campo : undefined;
}

/**
 * O número em `chave`, aceitando também número que veio como TEXTO.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O PostgREST devolve `numeric` como STRING, para não perder precisão.     │
 * │                                                                          │
 * │ `value numeric(14,2)` chega como `"259.90"`, não `259.9`. Lido pelo      │
 * │ `numero()` estrito ele vira `undefined`, e a receita some do cálculo     │
 * │ **sem erro nenhum** — a classe de bug mais cara deste projeto: some na   │
 * │ conta e aparece no relatório semanas depois.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Devolve `undefined` quando não há número nem texto numérico. Quem quer
 * zero como padrão decide isso no ponto de uso — aqui, ausência é ausência.
 */
export function numeroTolerante(
  valor: unknown,
  chave: string,
): number | undefined {
  const direto = numero(valor, chave);
  if (direto !== undefined) return direto;

  const comoTexto = texto(valor, chave);
  if (comoTexto === undefined || comoTexto.trim() === '') return undefined;

  const convertido = Number(comoTexto);
  return Number.isFinite(convertido) ? convertido : undefined;
}

/** O objeto aninhado em `chave`, ou `undefined`. */
export function objeto(valor: unknown, chave: string): Record<string, unknown> | undefined {
  if (!ehObjeto(valor)) return undefined;
  const campo = valor[chave];
  return ehObjeto(campo) ? campo : undefined;
}

/** A lista em `chave`, ou lista vazia. */
export function lista(valor: unknown, chave: string): unknown[] {
  if (!ehObjeto(valor)) return [];
  const campo = valor[chave];
  return Array.isArray(campo) ? campo : [];
}
