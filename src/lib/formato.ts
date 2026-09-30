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
export function moeda(valor: number, sigla = 'R$'): string {
  if (!Number.isFinite(valor)) return '—';
  const negativo = valor < 0;
  // `toFixed` arredonda meio-para-cima e não depende de locale nenhum.
  const [inteira = '0', decimal = '00'] = Math.abs(valor).toFixed(2).split('.');
  return `${negativo ? '-' : ''}${sigla} ${comMilhar(inteira)},${decimal}`;
}

/**
 * Moeda CURTA, para rótulo de eixo. `4000` → `R$ 4.000`; `1.5e6` → `R$ 1,5 mi`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ISTO SAIU DE UMA FOTO, COMO DA OUTRA VEZ.                                │
 * │                                                                          │
 * │ A calha do eixo tem 56px. `R$ 4.000,00` não cabe, então o navegador      │
 * │ QUEBRA a linha entre o símbolo e o número — e o "R$" sozinho em cima     │
 * │ vira o que parece ser outro valor. É literalmente a mesma queixa que já  │
 * │ apareceu com `R$ 37.158,70` no celular; aqui ela voltou por outra porta, │
 * │ no desktop, assim que a receita passou de mil.                           │
 * │                                                                          │
 * │ Alargar a calha resolveria no desktop e roubaria largura do gráfico no   │
 * │ celular, onde ela já come 14% da tela. A resposta certa é outra: rótulo  │
 * │ de eixo NÃO PRECISA de centavos. Ele existe para dar ordem de grandeza;  │
 * │ o valor exato, com centavos, está no tooltip a um toque de distância.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A abreviação só entra no milhão, e não no milhar, porque as marcas do eixo
 * saem de `teto/4` e caem em números como 1.125 ou 1.875 — "1,1 mil" jogaria
 * fora um dígito que cabia perfeitamente. Acima do milhão o dígito jogado
 * fora não muda a leitura do eixo, e o rótulo inteiro não caberia de jeito
 * nenhum.
 */
export function moedaCurta(valor: number, sigla = 'R$'): string {
  if (!Number.isFinite(valor)) return '—';

  const abs = Math.abs(valor);
  const sinal = valor < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    const milhoes = abs / 1_000_000;
    // Uma casa só abaixo de 10 milhões: `R$ 1,5 mi` informa, `R$ 12,4 mi`
    // não informa mais que `R$ 12 mi` e ocupa mais.
    const texto =
      milhoes < 10
        ? milhoes.toFixed(1).replace('.', ',')
        : String(Math.round(milhoes));
    return `${sinal}${sigla} ${texto} mi`;
  }

  return `${sinal}${sigla} ${comMilhar(String(Math.round(abs)))}`;
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
 * O símbolo da moeda ISO. `MXN` → `MX$`.
 *
 * A moeda é do GATEWAY, não nossa: a Pagou opera em MXN também, e
 * `purchases.currency` guarda o que veio. Desconhecida volta o próprio
 * código, que é honesto — melhor `PLN 40,00` que um `R$` inventado.
 *
 * Mora aqui e não dentro de uma tela porque duas telas mostram a mesma
 * venda: o faturamento e a gaveta do visitante. A gaveta nasceu formatando
 * tudo como `R$` e uma venda em MXN aparecia com valores diferentes nas
 * duas — duas telas discordando sobre o mesmo dinheiro.
 */
export function simbolo(moedaIso: string): string {
  return { BRL: 'R$', USD: 'US$', EUR: '€', MXN: 'MX$' }[moedaIso] ?? moedaIso;
}

/**
 * Múltiplo. `3.5891` → `3,59×`.
 *
 * Existe porque o ROAS estava saindo por `toFixed(2)` direto, e `toFixed`
 * devolve ponto: `3.59×` numa tela onde tudo ao lado é `R$ 3.475,90`. Pior
 * que feio — em pt-BR o ponto é separador de MILHAR, então `3.59` pede ao
 * olho brasileiro uma leitura de "três mil e quinhentos" antes de ele
 * corrigir. Num número que decide corte de campanha, esse tropeço não paga.
 *
 * Foi a captura de tela que pegou: o cálculo estava certo e ninguém tinha
 * olhado o separador.
 */
export function multiplo(valor: number, casas = 2): string {
  if (!Number.isFinite(valor)) return '—';
  const negativo = valor < 0;
  const [inteira = '0', decimal] = Math.abs(valor).toFixed(casas).split('.');
  const corpo =
    casas === 0
      ? comMilhar(inteira)
      : `${comMilhar(inteira)},${decimal ?? '0'}`;
  return `${negativo ? '-' : ''}${corpo}×`;
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
