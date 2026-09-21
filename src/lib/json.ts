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
