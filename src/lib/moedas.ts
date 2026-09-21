/**
 * As moedas que o painel oferece.
 *
 * Lista fechada de propósito: a moeda vai em toda conversão enviada à Meta e
 * ao GA4, e os dois recusam código fora do ISO 4217. Um campo de texto livre
 * aceitaria "R$" ou "reais" e a venda seria rejeitada lá na frente, longe de
 * onde o erro foi cometido.
 */

/** A tupla vem primeiro para o Zod derivar o enum sem conversão de tipo. */
export const CODIGOS_MOEDA = ['BRL', 'USD', 'EUR', 'GBP'] as const;

export type CodigoMoeda = (typeof CODIGOS_MOEDA)[number];

export const MOEDAS: readonly {
  codigo: CodigoMoeda;
  simbolo: string;
  nome: string;
}[] = [
  { codigo: 'BRL', simbolo: 'R$', nome: 'Real' },
  { codigo: 'USD', simbolo: 'US$', nome: 'Dólar americano' },
  { codigo: 'EUR', simbolo: '€', nome: 'Euro' },
  { codigo: 'GBP', simbolo: '£', nome: 'Libra esterlina' },
];

export function ehMoedaSuportada(valor: unknown): valor is CodigoMoeda {
  return typeof valor === 'string' && MOEDAS.some((m) => m.codigo === valor);
}

/** Formata um valor na moeda, no padrão brasileiro de separadores. */
export function formatarDinheiro(valor: number, codigo: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: ehMoedaSuportada(codigo) ? codigo : 'BRL',
  }).format(valor);
}
