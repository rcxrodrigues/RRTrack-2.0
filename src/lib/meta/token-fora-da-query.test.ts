import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Token da Meta não anda em query string. Em lugar nenhum.
 *
 * O CLAUDE.md diz isso duas vezes, uma por token, e o motivo é o mesmo:
 * query string aparece em log de proxy, em histórico de erro e em relatório
 * de crash. E estes dois não são pouca coisa — o da CAPI ESCREVE no pixel,
 * o de Ads LÊ a conta de anúncio inteira.
 *
 * O `capi.ts` (corpo do POST) e o `insights.ts` (cabeçalho Authorization)
 * sempre fizeram certo. O `meta/testar.ts` — o "Testar conexão" do painel,
 * que roda justamente na hora em que a pessoa acabou de colar a credencial
 * — fazia errado, e passou por uma auditoria inteira sem ninguém reparar:
 * regra escrita em prosa não varre arquivo. Esta varre.
 *
 * Só a Meta. O GA4 fica de fora de propósito: o Measurement Protocol EXIGE
 * `api_secret` na query, não oferece cabeçalho, e uma trava que não pode ser
 * obedecida vira exceção — e exceção ensina a ignorar a regra.
 */

const META = join(process.cwd(), 'src', 'lib', 'meta');

function arquivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) return arquivosDe(caminho);
    return /\.(ts|tsx)$/.test(entrada) && !entrada.endsWith('.test.ts') ? [caminho] : [];
  });
}

/** `searchParams.set('access_token', …)` e `?access_token=` montado à mão. */
const NA_QUERY = [
  /searchParams\.set\(\s*['"`]access_token['"`]/,
  /[?&]access_token=/,
];

describe('token da Meta fora da query string', () => {
  it('nenhum arquivo de lib/meta põe access_token na URL', () => {
    const infratores: string[] = [];

    for (const arquivo of arquivosDe(META)) {
      const codigo = readFileSync(arquivo, 'utf8');
      if (NA_QUERY.some((padrao) => padrao.test(codigo))) {
        infratores.push(relative(META, arquivo).replaceAll('\\', '/'));
      }
    }

    expect(infratores).toEqual([]);
  });

  it('o teste de conexão manda o token no cabeçalho', () => {
    const codigo = readFileSync(join(META, 'testar.ts'), 'utf8');
    expect(codigo).toContain('Authorization: `Bearer ${token}`');
  });
});
