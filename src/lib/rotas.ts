/**
 * Um `proximo=` que venha da URL é entrada de fora. Se ele fosse usado cru
 * num redirect, alguém poderia mandar `?proximo=https://site-falso.com` e usar
 * o nosso domínio como trampolim para uma página de phishing — o clássico
 * open redirect.
 *
 * Só passa caminho interno: começa com uma barra, não começa com duas
 * (`//site.com` é URL protocolo-relativa), e não tem esquema nem barra
 * invertida.
 */
export function caminhoInterno(bruto: unknown, padrao = '/'): string {
  if (typeof bruto !== 'string' || bruto.length === 0) return padrao;
  if (bruto.length > 512) return padrao;

  // Precisa começar com uma única barra.
  if (!bruto.startsWith('/') || bruto.startsWith('//')) return padrao;

  // Barra invertida e caracteres de controle confundem parsers de URL e
  // abrem espaço para injeção de cabeçalho. Casar com controles é justamente
  // o objetivo aqui, então a regra do linter não se aplica.
  // oxlint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(bruto)) return padrao;

  // Sem esquema embutido (`/\/evil.com`, `/javascript:...`).
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(bruto)) return padrao;

  return bruto;
}
