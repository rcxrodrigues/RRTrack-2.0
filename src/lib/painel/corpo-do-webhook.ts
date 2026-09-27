/**
 * O corpo guardado de um webhook, e como a tela deve descrevê-lo.
 *
 * Sem `server-only`: o componente que desenha a linha é cliente, e a decisão
 * de qual frase mostrar é pura — então mora aqui, onde dá para testá-la sem
 * montar React. A busca no banco continua em `eventos.ts`.
 */

export type CorpoDoWebhook = {
  corpo: unknown;
  corpoTexto: string | null;
  headers: Record<string, string> | null;
  /**
   * A retenção zerou os três campos acima.
   *
   * ┌───────────────────────────────────────────────────────────────────────┐
   * │ Sem isto, `corpo === null` tinha DOIS significados e a tela escolhia │
   * │ o errado: dizia "(não era JSON válido)" também para uma linha que a  │
   * │ retenção limpou. Um payload envelhecido lia como gateway quebrado, e │
   * │ o caminho até descobrir o contrário é depurar do lado de lá.         │
   * │                                                                      │
   * │ Deduzir por "os dois campos estão nulos" funcionaria hoje — e é o    │
   * │ mesmo erro do `platform` como proxy de camada: sintoma no lugar do   │
   * │ fato. `purged_at` é o fato.                                          │
   * └───────────────────────────────────────────────────────────────────────┘
   */
  purgado: boolean;
};

/**
 * Como a tela descreve o corpo, em três estados que antes eram dois.
 *
 * A ordem importa, e é ela o conserto: `purgado` vem PRIMEIRO. Os dois
 * primeiros casos terminam em `corpo === null` e só um é culpa do gateway —
 * chamar de "JSON inválido" o payload que nós mesmos limpamos manda a pessoa
 * depurar o checkout quando o que venceu foi prazo nosso.
 *
 * `null` significa "nada a dizer": o corpo está aí, e um rótulo ao lado de um
 * JSON legível só gastaria espaço.
 */
export function notaDoCorpo(payload: CorpoDoWebhook): string | null {
  if (payload.purgado) return '(removido pela retenção)';
  if (payload.corpo === null) return '(não era JSON válido)';
  return null;
}

/** O texto do bloco de código. Mesma ordem, mesma razão. */
export function textoDoCorpo(payload: CorpoDoWebhook): string {
  if (payload.purgado) {
    return 'O corpo foi removido pela retenção. A linha fica — data, adaptador e transaction_id seguem aqui.';
  }
  if (payload.corpo === null) return payload.corpoTexto ?? '(vazio)';
  return JSON.stringify(payload.corpo, null, 2);
}

/**
 * Ainda dá para reprocessar esta linha?
 *
 * Duas condições, e as duas pelo mesmo motivo: sem corpo não há o que ler, e
 * um corpo que não é JSON nenhum adaptador lê. O botão some nos dois casos —
 * oferecer uma ação que não pode dar certo é pior que não oferecer nenhuma.
 */
export function daParaReprocessar(payload: CorpoDoWebhook): boolean {
  return !payload.purgado && payload.corpo !== null;
}
