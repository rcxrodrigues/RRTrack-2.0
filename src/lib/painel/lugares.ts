import { ESTADOS_BRASIL, ufDaRegiao } from './mapa-brasil';

/**
 * Nome de lugar para a tela — `BR-SP` vira `São Paulo`, `BR` vira `Brasil`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ FOI A FOTO DO MAPA QUE PEGOU ISTO.                                       │
 * │                                                                          │
 * │ A árvore sempre mostrou o que vinha do cabeçalho — `BR-SP`, `BR-MG` —, e │
 * │ passava porque não havia com o que comparar. Com o mapa AO LADO dizendo  │
 * │ "São Paulo", a mesma linha virou código de máquina no painel de uma      │
 * │ pessoa. O par tornou visível um defeito que já estava lá.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE NÃO `Intl.DisplayNames`, QUE EXISTE PARA ISTO.                   │
 * │                                                                          │
 * │ Mesma armadilha do `Intl.NumberFormat` que o `formato.ts` já desvia, por │
 * │ outra porta: ele depende do ICU, e o ICU do Node **não é** o do          │
 * │ navegador. A árvore é renderizada no servidor e hidratada no cliente; se │
 * │ os dois escreverem o nome do país diferente — e escrevem, as versões de  │
 * │ ICU discordam em acento, em "Estados Unidos" vs "EUA", em ordem de       │
 * │ palavra —, o React vê textos diferentes e a hidratação quebra.           │
 * │                                                                          │
 * │ Tabela à mão, como a moeda. Determinística nos dois lados.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** Os estados vêm da mesma lista do mapa — um lugar só para os 27 nomes. */
const NOMES_DE_ESTADO = new Map(ESTADOS_BRASIL.map((e) => [e.uf, e.nome]));

/**
 * Os países que de fato aparecem no funil de uma loja brasileira.
 *
 * Parcial de propósito, e o que falta cai no CÓDIGO — que é exatamente o que
 * a tela mostra hoje. Uma tabela incompleta nunca mostra nome errado: ou
 * acerta, ou mostra a sigla. Inventar tradução de 249 países para um painel
 * que vai ver cinco seria trabalho com chance de errar e sem ganho.
 */
const NOMES_DE_PAIS: Record<string, string> = {
  BR: 'Brasil',
  PT: 'Portugal',
  US: 'Estados Unidos',
  AR: 'Argentina',
  UY: 'Uruguai',
  PY: 'Paraguai',
  CL: 'Chile',
  CO: 'Colômbia',
  PE: 'Peru',
  MX: 'México',
  ES: 'Espanha',
  IT: 'Itália',
  FR: 'França',
  DE: 'Alemanha',
  GB: 'Reino Unido',
  IE: 'Irlanda',
  NL: 'Países Baixos',
  BE: 'Bélgica',
  CH: 'Suíça',
  CA: 'Canadá',
  AU: 'Austrália',
  JP: 'Japão',
  AO: 'Angola',
  MZ: 'Moçambique',
  CV: 'Cabo Verde',
};

/** `BR-SP` ou `SP` → `São Paulo`. O que não for estado do Brasil volta cru. */
export function nomeDoEstado(regiao: string): string {
  const uf = ufDaRegiao(regiao);
  return (uf && NOMES_DE_ESTADO.get(uf)) ?? regiao;
}

/** `BR` → `Brasil`. País fora da tabela volta a sigla, nunca um nome errado. */
export function nomeDoPais(iso: string): string {
  return NOMES_DE_PAIS[iso.trim().toUpperCase()] ?? iso;
}
