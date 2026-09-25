import { describe, expect, it } from 'vitest';

import { lerUso, TETO_DE_USO } from './buc';

/**
 * Estourar a pontuação da Meta não devolve 429 educado: a conta fica
 * BLOQUEADA por até uma hora, e nesse tempo o painel não mostra ROAS nenhum.
 * É por isso que a leitura deste cabeçalho é conservadora em toda dúvida.
 */

function cabecalho(entrada: Record<string, unknown>): string {
  return JSON.stringify({ '1234567890': [{ type: 'ads_insights', ...entrada }] });
}

describe('lerUso', () => {
  it('lê os três indicadores e fica com o PIOR', () => {
    /*
     * `call_count` é o óbvio, mas uma consulta pesada estoura
     * `total_cputime` muito antes. Olhar só a contagem deixaria a conta ser
     * bloqueada por uma consulta só.
     */
    const uso = lerUso(
      cabecalho({ call_count: 4, total_cputime: 68, total_time: 12 }),
    );
    expect(uso.percentual).toBe(68);
    expect(uso.acimaDoTeto).toBe(true);
  });

  it('abaixo do teto segue liberado', () => {
    const uso = lerUso(cabecalho({ call_count: 10, total_cputime: 8 }));
    expect(uso.percentual).toBe(10);
    expect(uso.acimaDoTeto).toBe(false);
  });

  it('no teto exato já trava — a margem é o produto', () => {
    const uso = lerUso(cabecalho({ call_count: TETO_DE_USO }));
    expect(uso.acimaDoTeto).toBe(true);
  });

  it('bloqueio já aplicado trava mesmo com percentual baixo', () => {
    // A Meta zera os contadores ao bloquear; quem denuncia é este campo.
    const uso = lerUso(
      cabecalho({ call_count: 0, estimated_time_to_regain_access: 1800 }),
    );
    expect(uso.bloqueadoPor).toBe(1800);
    expect(uso.acimaDoTeto).toBe(true);
  });

  /*
   * Ausência não é "cheio". A Meta nem sempre manda o cabeçalho, e tratar
   * isso como limite estourado pararia o painel sem motivo nenhum.
   */
  it('cabeçalho ausente ou quebrado devolve zero, não pânico', () => {
    for (const valor of [null, '', 'não é json', '[]', 'null', '{}']) {
      const uso = lerUso(valor);
      expect(uso.percentual, String(valor)).toBe(0);
      expect(uso.acimaDoTeto, String(valor)).toBe(false);
    }
  });

  it('soma de várias contas fica com a pior', () => {
    const uso = lerUso(
      JSON.stringify({
        '111': [{ call_count: 5 }],
        '222': [{ call_count: 90 }],
      }),
    );
    expect(uso.percentual).toBe(90);
  });

  it('ignora campo que não é número', () => {
    const uso = lerUso(cabecalho({ call_count: 'muito', total_cputime: 7 }));
    expect(uso.percentual).toBe(7);
  });
});
