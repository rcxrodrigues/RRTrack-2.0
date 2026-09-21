/**
 * Contraste WCAG a partir de cores em HSL.
 *
 * Existe para a página de estilo medir o que está REALMENTE aplicado, lendo
 * as variáveis CSS computadas — e não um valor que alguém anotou uma vez e
 * esqueceu de atualizar. Se um token mudar e quebrar o contraste, a tela
 * mostra na hora.
 */

export type HSL = { h: number; s: number; l: number };

/** Lê `"224 100% 60%"` — o formato que usamos nos tokens. */
export function lerHsl(valor: string): HSL | null {
  const m = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(valor);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

function paraRgb({ h, s, l }: HSL): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) =>
    ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function doisDigitos(x: number): string {
  return Math.round(x * 255)
    .toString(16)
    .padStart(2, '0');
}

export function paraHex(cor: HSL): string {
  const [r, g, b] = paraRgb(cor);
  return `#${doisDigitos(r)}${doisDigitos(g)}${doisDigitos(b)}`;
}

/** sRGB com gama para linear — a etapa comum a luminância e OKLab. */
function linearizar(x: number): number {
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function luminancia(cor: HSL): number {
  const [r, g, b] = paraRgb(cor);
  return (
    0.2126 * linearizar(r) + 0.7152 * linearizar(g) + 0.0722 * linearizar(b)
  );
}

/** A razão de contraste entre duas cores, de 1:1 a 21:1. */
export function contraste(a: HSL, b: HSL): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * O veredito do WCAG para a razão.
 *
 * 4.5:1 é o mínimo para texto normal (AA); 3:1 vale para texto grande,
 * ícones e bordas; 7:1 é o nível AAA.
 */
export function nivelWcag(razao: number): {
  rotulo: string;
  ok: boolean;
  variante: 'success' | 'warning' | 'destructive';
} {
  if (razao >= 7) return { rotulo: 'AAA', ok: true, variante: 'success' };
  if (razao >= 4.5) return { rotulo: 'AA', ok: true, variante: 'success' };
  if (razao >= 3) return { rotulo: 'AA grande', ok: true, variante: 'warning' };
  return { rotulo: 'reprovado', ok: false, variante: 'destructive' };
}

// ---------------------------------------------------------------------------
// Distinguir cores é outra pergunta — e pede outra métrica
// ---------------------------------------------------------------------------

/**
 * Razão de contraste e distinguibilidade NÃO são a mesma coisa.
 *
 * Azul e âmbar podem ter praticamente a mesma luminância (contraste ~1.1:1) e
 * ainda assim ninguém os confunde: o que os separa é o matiz. Usar contraste
 * para checar se duas séries de um gráfico se distinguem dá falso negativo em
 * todo par de cores complementares.
 *
 * A medida certa é a distância perceptual — ΔE no espaço OKLab, onde a
 * distância euclidiana corresponde ao que o olho percebe como "diferente".
 */

type OKLab = { L: number; a: number; b: number };

function paraOklab(cor: HSL): OKLab {
  const [r, g, bl] = ((): [number, number, number] => {
    const s = cor.s / 100;
    const l = cor.l / 100;
    const k = (n: number) => (n + cor.h / 30) % 12;
    const amp = s * Math.min(l, 1 - l);
    const f = (n: number) =>
      l - amp * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  })();

  const R = linearizar(r);
  const G = linearizar(g);
  const B = linearizar(bl);

  // Cones long, medium e short, com a raiz cúbica que torna o espaço uniforme.
  const long = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const medium = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const short = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

  return {
    L: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  };
}

/**
 * Distância perceptual entre duas cores, na escala OKLab ×100.
 *
 * A skill de visualização trata 15 como o piso para leitura com visão normal
 * e 8 como alvo sob daltonismo — é a mesma escala.
 */
export function deltaE(a: HSL, b: HSL): number {
  const x = paraOklab(a);
  const y = paraOklab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b) * 100;
}
