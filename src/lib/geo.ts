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
 *
 * **A ORDEM importa, e não é a mesma nas duas configurações.** Com o proxy
 * ligado os DOIS conjuntos chegam: os da Vercel descrevendo a borda do
 * Cloudflare e os do Cloudflare descrevendo o visitante. Preferir a Vercel
 * ali devolve um datacenter. Ver `extrairGeo`.
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

/**
 * O Cloudflare está na frente?
 *
 * `cf-connecting-ip` é o sinal, e é o MESMO que `extrairIp` já usa. Quando ele
 * está presente, quem falou com a Vercel foi a borda do Cloudflare, não o
 * visitante.
 */
function atrasDoCloudflare(cabecalhos: LeitorDeCabecalho): boolean {
  return cabecalhos.get('cf-connecting-ip') !== null;
}

/**
 * O geo do visitante.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ COM O CLOUDFLARE NA FRENTE, OS CABEÇALHOS DA VERCEL DESCREVEM A BORDA    │
 * │ DO CLOUDFLARE — NÃO O VISITANTE. E este arquivo se contradizia.          │
 * │                                                                          │
 * │ `extrairIp` já lia `cf-connecting-ip` PRIMEIRO, exatamente por isso. O   │
 * │ geo fazia o contrário: `x-vercel-ip-* ?? cf-*`. Com o proxy ligado os    │
 * │ DOIS conjuntos chegam, o `??` nunca cai para o segundo, e a Vercel       │
 * │ responde sobre um datacenter. Resultado observado: o IP certo e o geo    │
 * │ dizendo "The Dalles, Oregon" para quem estava em Minas Gerais.           │
 * │                                                                          │
 * │ O teste antigo cobria só "a Vercel não mandou nada" — o caso em que os   │
 * │ dois chegam, que é o que acontece de verdade com a nuvem laranja, nunca  │
 * │ foi exercitado. Por isso a contradição passou.                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * **Cloudflare manda só o país por padrão.** Região e cidade exigem ligar o
 * managed transform "Add visitor location headers" no painel dele. Sem isso o
 * visitante chega com país e sem o resto — que é honesto e vira "Não
 * informado" na árvore, em vez de um datacenter americano que mente.
 */
export function extrairGeo(cabecalhos: LeitorDeCabecalho): Geo {
  const cloudflare = atrasDoCloudflare(cabecalhos);

  /*
   * Com o Cloudflare na frente NÃO HÁ RESERVA: os cabeçalhos da Vercel estão
   * errados por construção, não apenas em segundo lugar. Cair neles quando
   * falta a região do Cloudflare — que é o padrão, porque ele só manda o país
   * sem o managed transform — traria de volta exatamente o Oregon que esta
   * correção existe para tirar. Ausente é `null`: "não sei" é honesto, um
   * datacenter no lugar da cidade de quem comprou não é.
   */
  const daFonte = (daVercel: string, doCloudflare: string): string | null =>
    cloudflare
      ? cabecalhos.get(doCloudflare)
      : (cabecalhos.get(daVercel) ?? cabecalhos.get(doCloudflare));

  return {
    ip: extrairIp(cabecalhos),
    pais: normalizarPais(daFonte('x-vercel-ip-country', 'cf-ipcountry')),
    regiao: decodificar(
      daFonte('x-vercel-ip-country-region', 'cf-region-code'),
    ),
    cidade: decodificar(daFonte('x-vercel-ip-city', 'cf-ipcity')),
  };
}
