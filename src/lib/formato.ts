/**
 * Números para a tela, formatados à mão.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Por que não `Intl.NumberFormat`: ele depende do ICU, e a versão do ICU   │
 * │ do Node não é a do navegador. Em moeda pt-BR a diferença aparece no      │
 * │ espaço entre "R$" e o número — um usa espaço normal, outro usa           │
 * │ no-break space. O texto parece igual, o React vê diferente, e a          │
 * │ hidratação quebra num componente que passou por SSR.                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * É a mesma armadilha do `toLocaleString` em data, por outra porta — e a
 * moeda é pior, porque o erro depende de qual navegador abriu a página.
 *
 * pt-BR é simples o bastante para não precisar de biblioteca: ponto no
 * milhar, vírgula no decimal.
 */

/** Agrupa o milhar com ponto. Recebe os dígitos já prontos. */
function comMilhar(digitos: string): string {
  let saida = '';
  for (let i = 0; i < digitos.length; i++) {
    // Conta a partir da DIREITA: o primeiro grupo é que pode ser incompleto.
    const daDireita = digitos.length - i;
    saida += digitos[i];
    if (daDireita > 1 && (daDireita - 1) % 3 === 0) saida += '.';
  }
  return saida;
}

/** Inteiro com separador de milhar. `1234` → `1.234`. */
export function inteiro(valor: number): string {
  if (!Number.isFinite(valor)) return '—';
  const negativo = valor < 0;
  const digitos = String(Math.round(Math.abs(valor)));
  return (negativo ? '-' : '') + comMilhar(digitos);
}

/**
 * Moeda. `1234.5` → `R$ 1.234,50`.
 *
 * Duas casas sempre: um preço com uma casa parece truncado, e a coluna de
 * valores fica desalinhada mesmo com numeral tabular.
 */
export function moeda(valor: number, simbolo = 'R$'): string {
  if (!Number.isFinite(valor)) return '—';
  const negativo = valor < 0;
  // `toFixed` arredonda meio-para-cima e não depende de locale nenhum.
  const [inteira = '0', decimal = '00'] = Math.abs(valor).toFixed(2).split('.');
  return `${negativo ? '-' : ''}${simbolo} ${comMilhar(inteira)},${decimal}`;
}

/**
 * Percentual com uma casa. `0.1234` → `12,3%`.
 *
 * Recebe a FRAÇÃO, não o número já multiplicado: passar 12.34 esperando
 * "12,3%" daria 1.234% e ninguém desconfiaria de um número grande num painel
 * de tráfego pago.
 */
export function percentual(fracao: number, casas = 1): string {
  if (!Number.isFinite(fracao)) return '—';
  const [inteira = '0', decimal] = (fracao * 100).toFixed(casas).split('.');
  return casas === 0 ? `${inteira}%` : `${inteira},${decimal ?? '0'}%`;
}

/**
 * A razão entre dois números, ou `null` quando não há razão que fazer.
 *
 * Divisão por zero não é "0%": é "não deu para calcular". Devolver zero
 * faria o painel afirmar que a conversão foi nula num dia sem visitante
 * nenhum — e `—` é a resposta honesta, que é o que o `MetricCard` mostra.
 */
export function razao(parte: number, total: number): number | null {
  return total > 0 ? parte / total : null;
}

/**
 * A variação contra o período anterior, como fração.
 *
 * `null` quando o anterior foi zero: sair de 0 para 10 não é "+1000%", é uma
 * comparação que não existe. Mostrar um percentual ali seria inventar
 * precisão.
 */
export function variacao(agora: number, antes: number): number | null {
  return antes > 0 ? (agora - antes) / antes : null;
}
