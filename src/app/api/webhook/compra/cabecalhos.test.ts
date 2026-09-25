import { describe, expect, it } from 'vitest';

import { cabecalhosSeguros } from './route';

/**
 * O token do webhook não pode ficar na linha de auditoria.
 *
 * Ela é lida pelo painel e impressa na tela, e o token é o que autoriza
 * gravar uma venda no sistema. Vazado, ele deixa qualquer um inventar
 * faturamento e mandar conversão falsa para a Meta.
 *
 * O mascaramento é por VALOR: a lista de nomes cresce a cada gateway, e
 * esquecer um seria silencioso.
 */

const TOKEN = 'trk_9f2c41ab77e04d5e9c1b3a6d8e2f5071';

function cabecalhos(pares: Record<string, string>): Headers {
  return new Headers(pares);
}

describe('cabecalhosSeguros', () => {
  it('oculta o Bearer da Zedy', () => {
    const saida = cabecalhosSeguros(
      cabecalhos({ authorization: `Bearer ${TOKEN}` }),
      TOKEN,
    );
    expect(saida.authorization).not.toContain(TOKEN);
  });

  it('oculta o x-webhook-token', () => {
    const saida = cabecalhosSeguros(cabecalhos({ 'x-webhook-token': TOKEN }), TOKEN);
    expect(saida['x-webhook-token']).not.toContain(TOKEN);
  });

  it('oculta o x-adoorei-hash, que é token puro apesar do nome', () => {
    const saida = cabecalhosSeguros(cabecalhos({ 'x-adoorei-hash': TOKEN }), TOKEN);
    expect(saida['x-adoorei-hash']).not.toContain(TOKEN);
  });

  /*
   * O caso que a lista de nomes não pegaria: um gateway futuro inventa o
   * nome dele. Por isso a comparação é contra o VALOR.
   */
  it('oculta um cabeçalho de nome desconhecido que carregue o token', () => {
    const saida = cabecalhosSeguros(
      cabecalhos({ 'x-millions-secret': `token=${TOKEN};v=1` }),
      TOKEN,
    );
    expect(saida['x-millions-secret']).not.toContain(TOKEN);
  });

  it('o NOME fica sempre — é ele que diz como o gateway assina', () => {
    const saida = cabecalhosSeguros(
      cabecalhos({ 'x-adoorei-hash': TOKEN, authorization: `Bearer ${TOKEN}` }),
      TOKEN,
    );
    expect(Object.keys(saida).toSorted()).toEqual(['authorization', 'x-adoorei-hash']);
  });

  /*
   * A assinatura HMAC FICA. Ela é resumo de um payload só — não serve para
   * assinar outro — e é exatamente o que falta para fechar as fórmulas da
   * Yampi e da MillionsPay. Mascará-la apagaria a informação que o registro
   * existe para capturar.
   */
  it('preserva a assinatura HMAC, que não é segredo reutilizável', () => {
    const assinatura = 'sha256=4f2a1c9b8e7d6a5f4e3d2c1b0a9f8e7d';
    const saida = cabecalhosSeguros(
      cabecalhos({ 'x-yampi-hmac-sha256': assinatura, 'content-type': 'application/json' }),
      TOKEN,
    );
    expect(saida['x-yampi-hmac-sha256']).toBe(assinatura);
    expect(saida['content-type']).toBe('application/json');
  });

  it('oculta cookie mesmo sem o token dentro — sessão não é auditoria', () => {
    const saida = cabecalhosSeguros(cabecalhos({ cookie: 'sb-access-token=abc' }), TOKEN);
    expect(saida.cookie).not.toContain('abc');
  });

  /*
   * Token curto casaria por acaso dentro de qualquer cabeçalho e mascararia
   * a linha inteira — apagando o diagnóstico para proteger o que já não
   * estava protegido.
   */
  it('token curto demais não mascara tudo', () => {
    const saida = cabecalhosSeguros(
      cabecalhos({ 'user-agent': 'Appmax/1.0', 'x-forwarded-for': '1.2.3.4' }),
      '1',
    );
    expect(saida['user-agent']).toBe('Appmax/1.0');
    expect(saida['x-forwarded-for']).toBe('1.2.3.4');
  });
});
