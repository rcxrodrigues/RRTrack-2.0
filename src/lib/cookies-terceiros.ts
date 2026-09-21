/**
 * Leitura dos cookies que o Pixel da Meta e a gtag do Google deixam no
 * navegador do visitante.
 *
 * São eles que fazem a Meta e o Google reconhecerem que o evento que sai do
 * NOSSO servidor é da mesma pessoa que o pixel viu no navegador. Sem `fbp` e
 * `fbc`, a Conversions API recebe um evento sem quem; sem o `client_id` do
 * `_ga`, a compra do webhook entra no GA4 como uma sessão nova e a atribuição
 * se perde.
 *
 * Nenhum destes é hasheado ao ser enviado — são identificadores de navegador,
 * não dado pessoal.
 */

/**
 * `_ga` tem a forma `GA1.1.<client_id>`, onde o client_id são os DOIS últimos
 * segmentos: `1234567890.1234567890`. A contagem de segmentos do prefixo varia
 * conforme o domínio, então lemos do fim para o começo.
 */
export function clientIdDoGa(valorDoCookie: string | undefined): string | null {
  if (!valorDoCookie) return null;

  const partes = valorDoCookie.trim().split('.');
  if (partes.length < 4) return null;

  const [aleatorio, timestamp] = partes.slice(-2);
  if (!aleatorio || !timestamp) return null;
  if (!/^\d+$/.test(aleatorio) || !/^\d+$/.test(timestamp)) return null;

  return `${aleatorio}.${timestamp}`;
}

/**
 * `_ga_<CONTAINER>` guarda a sessão, e o formato mudou com o tempo:
 *
 *   GS1.1.<session_id>.<n>.<…>
 *   GS2.1.s<session_id>$o<n>$g<n>$t<…>
 *
 * Os dois aparecem em campo, então lemos ambos — o GA4 de um site antigo pode
 * muito bem ainda estar gravando no formato velho.
 */
export function sessionIdDoGa(valorDoCookie: string | undefined): string | null {
  if (!valorDoCookie) return null;
  const valor = valorDoCookie.trim();

  // GS2: o session_id é o número depois do `s`, antes do primeiro `$`.
  const gs2 = /^GS2\.\d+\.s(\d+)/.exec(valor);
  if (gs2?.[1]) return gs2[1];

  // GS1: terceiro segmento.
  const gs1 = /^GS1\.\d+\.(\d+)\./.exec(valor);
  if (gs1?.[1]) return gs1[1];

  return null;
}

/** O nome do cookie de sessão do GA4 para um measurement id `G-ABC123`. */
export function nomeCookieSessaoGa(measurementId: string): string {
  return `_ga_${measurementId.replace(/^G-/, '')}`;
}

/** `_fbp` e `_fbc` têm a forma `fb.<subdominio>.<timestamp>.<valor>`. */
function ehFormatoFacebook(valor: string): boolean {
  return /^fb\.\d+\.\d+\..+$/.test(valor);
}

export function lerFbp(valorDoCookie: string | undefined): string | null {
  const v = valorDoCookie?.trim();
  return v && ehFormatoFacebook(v) ? v : null;
}

/**
 * O `_fbc` do cookie, ou um montado a partir do `fbclid` da URL.
 *
 * Este segundo caso importa mais do que parece: o cookie `_fbc` só existe
 * depois que o Pixel roda no navegador. Se o visitante tem bloqueador, ou se
 * o evento sai antes do Pixel carregar, o clique do anúncio se perderia — e
 * é justamente o clique que liga a venda à campanha.
 *
 * O formato que a Meta espera é `fb.1.<timestamp>.<fbclid>`.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 */
export function lerOuMontarFbc(
  valorDoCookie: string | undefined,
  fbclidDaUrl: string | null | undefined,
  agora: number = Date.now(),
): string | null {
  const doCookie = valorDoCookie?.trim();
  if (doCookie && ehFormatoFacebook(doCookie)) return doCookie;

  const fbclid = fbclidDaUrl?.trim();
  if (!fbclid) return null;
  // O fbclid é opaco, mas nunca traz ponto nem espaço; o que tiver, não é um.
  if (!/^[\w-]+$/.test(fbclid)) return null;

  return `fb.1.${agora}.${fbclid}`;
}

/** Transforma o cabeçalho `Cookie` num mapa. */
export function lerCookies(cabecalho: string | null | undefined): Map<string, string> {
  const mapa = new Map<string, string>();
  if (!cabecalho) return mapa;

  for (const pedaco of cabecalho.split(';')) {
    const igual = pedaco.indexOf('=');
    if (igual < 1) continue;
    const nome = pedaco.slice(0, igual).trim();
    const valor = pedaco.slice(igual + 1).trim();
    if (nome && !mapa.has(nome)) mapa.set(nome, valor);
  }
  return mapa;
}
