/**
 * IP e localização de quem está visitando.
 *
 * Funciona nas duas configurações possíveis do projeto, porque a resposta
 * certa depende de o Cloudflare estar ou não na frente da Vercel:
 *
 *   - nuvem cinza (DNS only): a Vercel vê o visitante, e valem os
 *     cabeçalhos `x-vercel-ip-*`
 *   - nuvem laranja (proxy):  a Vercel vê o Cloudflare, e o IP real está em
 *     `cf-connecting-ip`, com o país em `cf-ipcountry`
 *
 * Ler os dois evita que uma mudança no DNS quebre o geo em silêncio — e é o
 * tipo de falha que ninguém percebe até o mapa esvaziar.
 */

export type Geo = {
  ip: string | null;
  pais: string | null;
  regiao: string | null;
  cidade: string | null;
};

type LeitorDeCabecalho = { get(nome: string): string | null };

/** Um IPv4 ou IPv6 plausível. Não confiamos no que vem de fora. */
export function ehIpValido(valor: string): boolean {
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (v4.test(valor)) {
    return valor.split('.').every((p) => {
      const n = Number(p);
      return n >= 0 && n <= 255 && String(n) === p.replace(/^0+(?=\d)/, '');
    });
  }
  // IPv6: hexadecimais e dois-pontos, com a forma abreviada `::`.
  return /^[0-9a-f:]+$/i.test(valor) && valor.includes(':') && valor.length <= 45;
}

/**
 * O IP do visitante.
 *
 * `x-forwarded-for` é uma LISTA: o cliente pode antepor valores próprios, e
 * cada proxy no caminho acrescenta o seu ao final. O primeiro é o que
 * interessa, mas só vale confiar nele porque a Vercel reescreve o cabeçalho
 * na borda — num servidor sem proxy confiável à frente, isso seria
 * falsificável.
 */
export function extrairIp(cabecalhos: LeitorDeCabecalho): string | null {
  const candidatos = [
    cabecalhos.get('cf-connecting-ip'), // Cloudflare, quando está na frente
    cabecalhos.get('x-real-ip'),
    cabecalhos.get('x-forwarded-for')?.split(',')[0],
  ];

  for (const bruto of candidatos) {
    const ip = bruto?.trim();
    if (ip && ehIpValido(ip)) return ip;
  }
  return null;
}

/**
 * A Vercel envia o nome da cidade percent-encoded (`S%C3%A3o%20Paulo`).
 * Guardar sem decodificar deixaria o mapa cheio de "S%C3%A3o Paulo".
 */
function decodificar(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.trim();
  if (limpo.length === 0) return null;

  try {
    return decodeURIComponent(limpo);
  } catch {
    // Percent-encoding malformado: melhor o valor cru que perder o dado.
    return limpo;
  }
}

/** País em ISO-3166 alpha-2, maiúsculo. `XX` da Cloudflare significa "não sei". */
function normalizarPais(valor: string | null | undefined): string | null {
  const pais = valor?.trim().toUpperCase();
  if (!pais || pais.length !== 2 || pais === 'XX' || pais === 'T1') return null;
  return pais;
}

export function extrairGeo(cabecalhos: LeitorDeCabecalho): Geo {
  return {
    ip: extrairIp(cabecalhos),
    pais: normalizarPais(
      cabecalhos.get('x-vercel-ip-country') ?? cabecalhos.get('cf-ipcountry'),
    ),
    regiao: decodificar(
      cabecalhos.get('x-vercel-ip-country-region') ?? cabecalhos.get('cf-region-code'),
    ),
    cidade: decodificar(
      cabecalhos.get('x-vercel-ip-city') ?? cabecalhos.get('cf-ipcity'),
    ),
  };
}
