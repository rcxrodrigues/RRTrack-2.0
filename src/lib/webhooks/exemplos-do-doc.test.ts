import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { lerWebhook } from './index';

/**
 * Os payloads de `docs/TESTAR-VENDA.md`, exercitados de verdade.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DOCUMENTO COM EXEMPLO QUEBRADO É PIOR QUE DOCUMENTO NENHUM.               │
 * │                                                                          │
 * │ Quem cola um curl do doc e leva 202 conclui que o SISTEMA está errado,   │
 * │ não o exemplo — e vai depurar o lugar errado, justo no dia em que está   │
 * │ tentando ligar o checkout. Estes testes prendem o doc ao código: mexeu   │
 * │ no adaptador e o exemplo parou de valer, quebra aqui, não lá.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * As duas asserções que importam em cada um:
 *
 * 1. **O adaptador reconhece** — senão a rota devolve 202 e a venda fica
 *    parada em `webhooks_recebidos`.
 * 2. **O `trck_user_id` foi extraído** — que é o ponto do teste inteiro. Cada
 *    gateway o devolve num campo diferente, e mandar no campo errado **não
 *    dá erro**: o checkout ignora, a venda entra e chega órfã. Um exemplo
 *    com o campo errado ensinaria exatamente o erro que ele existe para
 *    evitar.
 */

const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

const DOC = path.join(process.cwd(), 'docs/TESTAR-VENDA.md');

/**
 * Os payloads lidos DO DOCUMENTO, não copiados dele.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CÓPIA NÃO PRENDE NADA.                                                   │
 * │                                                                          │
 * │ A primeira versão deste arquivo trazia os cinco payloads escritos à mão  │
 * │ aqui dentro, e o cabeçalho prometia "prende o doc ao código". Não        │
 * │ prendia: mexer no curl do documento deixava a suíte VERDE e o comando    │
 * │ publicado passava a devolver 202. Exatamente a falha que o documento     │
 * │ existe para evitar — quem cola e leva 202 conclui que o sistema está     │
 * │ errado e vai depurar o lugar errado.                                     │
 * │                                                                          │
 * │ Agora o documento É a fixture: o teste extrai o corpo de cada `-d` dos   │
 * │ blocos de curl. Mexeu no doc e o exemplo parou de valer → quebra aqui.   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
function exemplosDoDoc(): { gateway: string; corpo: unknown }[] {
  const markdown = fs.readFileSync(DOC, 'utf8');

  /*
   * Só o Passo 1. O Passo 2 fala em trocar o evento para o de aprovação, e
   * aprovada DISPARA conversão — a asserção de `pendente` abaixo é a trava
   * que prova que o passo seguro é seguro.
   */
  const passo1 = markdown.slice(
    markdown.indexOf('## Passo 1'),
    markdown.indexOf('## O que conferir'),
  );

  const achados: { gateway: string; corpo: unknown }[] = [];
  // Cada `### Gateway` seguido de um bloco ```bash com um `-d '...'`.
  const blocos = passo1.split(/^### /m).slice(1);

  for (const bloco of blocos) {
    const gateway = (bloco.split('\n')[0] ?? '').trim().toLowerCase();
    const corpoCru = /-d '([\s\S]*?)'\s*$/m.exec(bloco)?.[1];
    if (corpoCru === undefined) continue;

    achados.push({
      gateway,
      corpo: JSON.parse(corpoCru.replaceAll('SEU_TRCK_USER_ID', ID)),
    });
  }

  return achados;
}

const EXEMPLOS = exemplosDoDoc();

describe('os exemplos de docs/TESTAR-VENDA.md', () => {
  it('achou os cinco no documento', () => {
    /*
     * Sem esta contagem, um `it.each` sobre lista vazia passa sem rodar
     * nada — e a suíte ficaria verde justamente quando a extração quebrasse,
     * que é o contrário do que este arquivo existe para fazer.
     */
    expect(EXEMPLOS.map((e) => e.gateway)).toEqual([
      'appmax',
      'yampi',
      'zedy',
      'adoorei',
      'pagou',
    ]);
  });

  it.each(EXEMPLOS)('$gateway: o adaptador certo reconhece', ({ gateway, corpo }) => {
    const lido = lerWebhook(corpo, { statusPorAlias: {} });
    // 'desconhecido' aqui significaria 202 na rota e curl "falhando" à toa.
    expect(lido.tipo, JSON.stringify(lido)).toBe('venda');
    if (lido.tipo !== 'venda') return;
    // E tem de ser o adaptador DAQUELE gateway: Yampi e Adoorei usam o mesmo
    // envelope, e um engolindo o payload do outro leria tudo errado.
    expect(lido.adaptador).toBe(gateway);
  });

  it.each(EXEMPLOS)('$gateway: o trck_user_id atravessa', ({ corpo }) => {
    const lido = lerWebhook(corpo, { statusPorAlias: {} });
    if (lido.tipo !== 'venda') throw new Error('não virou venda');
    expect(lido.compra.trckUserId).toBe(ID);
  });

  it.each(EXEMPLOS)('$gateway: entra como PENDENTE, sem disparar a Meta', ({ corpo }) => {
    /*
     * É a trava do Passo 1 do doc. Só `aprovada` dispara conversão; se algum
     * destes exemplos virasse `aprovada` sem querer, o "teste seguro"
     * mandaria um Purchase de verdade para o pixel — e a Conversions API não
     * tem como desfazer.
     */
    const lido = lerWebhook(corpo, { statusPorAlias: {} });
    if (lido.tipo !== 'venda') throw new Error('não virou venda');
    expect(lido.compra.status).toBe('pendente');
  });
});
