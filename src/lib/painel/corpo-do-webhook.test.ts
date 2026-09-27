import { describe, expect, it } from 'vitest';

import {
  daParaReprocessar,
  notaDoCorpo,
  textoDoCorpo,
  type CorpoDoWebhook,
} from './corpo-do-webhook';

function payload(p: Partial<CorpoDoWebhook>): CorpoDoWebhook {
  return { corpo: null, corpoTexto: null, headers: null, purgado: false, ...p };
}

describe('como a tela descreve o corpo guardado', () => {
  it('mostra o JSON e nenhum rótulo quando o corpo está lá', () => {
    const p = payload({ corpo: { event: 'order.paid' } });
    expect(notaDoCorpo(p)).toBeNull();
    expect(textoDoCorpo(p)).toContain('order.paid');
    expect(daParaReprocessar(p)).toBe(true);
  });

  it('diz "não era JSON válido" e mostra o texto cru', () => {
    const p = payload({ corpoTexto: '<html>502 Bad Gateway</html>' });
    expect(notaDoCorpo(p)).toBe('(não era JSON válido)');
    expect(textoDoCorpo(p)).toBe('<html>502 Bad Gateway</html>');
    // Nenhum adaptador lê o que não é JSON: não há o que reprocessar.
    expect(daParaReprocessar(p)).toBe(false);
  });

  /*
   * O DEFEITO QUE ISTO TRAVA.
   *
   * Uma linha que a retenção limpou chega com `corpo` nulo, igualzinho à que
   * veio com JSON quebrado — e a tela dizia "(não era JSON válido)" nas duas.
   * Quem visse isso num payload de 100 dias concluiria que o gateway manda
   * lixo, e iria depurar o lado de lá. O que venceu foi prazo nosso.
   */
  it('NÃO chama de JSON inválido o corpo que a retenção levou', () => {
    const p = payload({ purgado: true });
    expect(notaDoCorpo(p)).toBe('(removido pela retenção)');
    expect(textoDoCorpo(p)).toContain('retenção');
    expect(daParaReprocessar(p)).toBe(false);
  });

  it('a retenção ganha do JSON inválido, mesmo com texto cru sobrando', () => {
    // Na prática a retenção zera os dois campos juntos. O teste fixa a
    // PRECEDÊNCIA de todo modo: se um dia sobrar texto numa linha purgada, a
    // frase certa continua sendo a da retenção — quem limpou fomos nós.
    const p = payload({ purgado: true, corpoTexto: 'sobra' });
    expect(notaDoCorpo(p)).toBe('(removido pela retenção)');
    expect(daParaReprocessar(p)).toBe(false);
  });

  it('corpo vazio não é corpo ausente', () => {
    // O gateway que faz POST sem corpo cai aqui: `corpo_texto` é string
    // vazia, não null. "(vazio)" é a verdade; "removido" seria mentira.
    const p = payload({ corpoTexto: '' });
    expect(notaDoCorpo(p)).toBe('(não era JSON válido)');
    expect(textoDoCorpo(p)).toBe('');
  });
});
