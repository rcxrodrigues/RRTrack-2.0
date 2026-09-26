import { describe, expect, it } from 'vitest';

import { inteiro, moeda, multiplo, percentual, razao, variacao } from './formato';

/**
 * A formatação é feita à mão porque `Intl.NumberFormat` depende do ICU, e o
 * ICU do Node não é o do navegador — em moeda pt-BR a diferença é o tipo de
 * espaço depois do "R$", que o React vê e a hidratação recusa.
 *
 * Estes vetores existem para a implementação manual não errar o básico.
 */

describe('inteiro', () => {
  it('agrupa o milhar', () => {
    expect(inteiro(0)).toBe('0');
    expect(inteiro(7)).toBe('7');
    expect(inteiro(999)).toBe('999');
    expect(inteiro(1000)).toBe('1.000');
    expect(inteiro(12345)).toBe('12.345');
    expect(inteiro(1234567)).toBe('1.234.567');
  });

  it('o primeiro grupo é o que pode ser incompleto', () => {
    // O erro clássico de agrupar da esquerda: `1.234.567` virando `123.456.7`.
    expect(inteiro(1234)).toBe('1.234');
    expect(inteiro(123456)).toBe('123.456');
  });

  it('negativo e quebrado', () => {
    expect(inteiro(-4200)).toBe('-4.200');
    expect(inteiro(1234.7)).toBe('1.235');
    expect(inteiro(Number.NaN)).toBe('—');
    expect(inteiro(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('moeda', () => {
  it('duas casas, sempre', () => {
    expect(moeda(0)).toBe('R$ 0,00');
    expect(moeda(9.5)).toBe('R$ 9,50');
    expect(moeda(259.9)).toBe('R$ 259,90');
    expect(moeda(1234.56)).toBe('R$ 1.234,56');
    expect(moeda(1000000)).toBe('R$ 1.000.000,00');
  });

  it('arredonda o centavo, não trunca', () => {
    expect(moeda(0.005)).toBe('R$ 0,01');
    expect(moeda(19.999)).toBe('R$ 20,00');
  });

  it('negativo mantém o sinal antes do símbolo', () => {
    expect(moeda(-50)).toBe('-R$ 50,00');
  });

  it('aceita outro símbolo — a moeda é configuração', () => {
    expect(moeda(10, 'US$')).toBe('US$ 10,00');
  });

  it('sem número, travessão', () => {
    expect(moeda(Number.NaN)).toBe('—');
  });
});

describe('percentual', () => {
  it('recebe a FRAÇÃO, não o número já multiplicado', () => {
    // Passar 12.34 esperando "12,3%" daria 1.234% — e num painel de tráfego
    // pago ninguém desconfia de um número grande.
    expect(percentual(0.1234)).toBe('12,3%');
    expect(percentual(1)).toBe('100,0%');
    expect(percentual(0)).toBe('0,0%');
  });

  it('sem casas quando pedido', () => {
    expect(percentual(0.1234, 0)).toBe('12%');
  });
});

describe('razao', () => {
  it('divide quando há o que dividir', () => {
    expect(razao(5, 20)).toBe(0.25);
  });

  /*
   * Divisão por zero não é 0%: é "não deu para calcular". Devolver zero faria
   * o painel afirmar que a conversão foi nula num dia sem visitante nenhum.
   */
  it('total zero devolve null, não zero', () => {
    expect(razao(0, 0)).toBeNull();
    expect(razao(5, 0)).toBeNull();
  });
});

describe('variacao', () => {
  it('compara com o anterior', () => {
    expect(variacao(150, 100)).toBeCloseTo(0.5);
    expect(variacao(50, 100)).toBeCloseTo(-0.5);
  });

  it('sair do zero não é +1000% — é comparação que não existe', () => {
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(0, 0)).toBeNull();
  });
});

describe('multiplo', () => {
  it('usa VÍRGULA, não ponto', () => {
    /*
     * O ROAS saía por `toFixed(2)` direto e virava `3.59×` numa tela onde
     * tudo ao lado é `R$ 3.475,90`. Em pt-BR o ponto é separador de MILHAR,
     * então o olho lê "três mil" antes de corrigir — num número que decide
     * corte de campanha, esse tropeço não paga.
     */
    expect(multiplo(3.5891)).toBe('3,59×');
    expect(multiplo(3.5891)).not.toContain('.');
  });

  it('agrupa o milhar quando o múltiplo é grande', () => {
    expect(multiplo(1234.5)).toBe('1.234,50×');
  });

  it('zero é medida e aparece', () => {
    // `0,00×` é gastou-e-não-vendeu. Quem não tem medida é `null`, e quem
    // decide mostrar `—` é o MetricCard — não esta função.
    expect(multiplo(0)).toBe('0,00×');
  });

  it('Infinity e NaN viram travessão em vez de ir para a tela', () => {
    expect(multiplo(Number.POSITIVE_INFINITY)).toBe('—');
    expect(multiplo(Number.NaN)).toBe('—');
  });

  it('negativo mantém o sinal', () => {
    expect(multiplo(-1.5)).toBe('-1,50×');
  });
});
