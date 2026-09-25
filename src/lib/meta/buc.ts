import { ehObjeto } from '@/lib/json';

/**
 * A pontuação de uso da Meta — `X-Business-Use-Case-Usage`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A Meta não limita por "requisições por minuto". Ela dá uma PONTUAÇÃO por │
 * │ conta de negócio, e cada chamada gasta um tanto que depende do peso da   │
 * │ consulta. Estourar não devolve 429 educado: a conta fica BLOQUEADA por  │
 * │ até uma hora, e nesse tempo o painel não mostra ROAS nenhum.             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Tier de desenvolvimento: 60 pontos. Standard: 9.000. A doc trata 70-80%
 * como zona de alerta — **paramos em 25%**, bem antes, porque um painel que
 * atrasa cinco minutos é irritante e um painel bloqueado por uma hora é
 * inútil. A diferença de custo entre os dois erros não é simétrica.
 */

/** O teto que respeitamos, bem abaixo do que a Meta permite. */
export const TETO_DE_USO = 25;

export type UsoDaConta = {
  /** 0–100. O maior dos três indicadores que a Meta devolve. */
  percentual: number;
  /** Segundos até destravar, quando a Meta já bloqueou. */
  bloqueadoPor: number;
  /** `true` quando passamos do nosso teto — não do da Meta. */
  acimaDoTeto: boolean;
};

const SEM_USO: UsoDaConta = {
  percentual: 0,
  bloqueadoPor: 0,
  acimaDoTeto: false,
};

/**
 * Lê o cabeçalho e devolve o pior número que ele contém.
 *
 * O formato é `{"<id_da_conta>":[{"type":"ads_insights","call_count":28,
 * "total_cputime":25,"total_time":25,"estimated_time_to_regain_access":0}]}`.
 *
 * **Os TRÊS contam, e o maior manda.** `call_count` é o óbvio, mas uma
 * consulta pesada estoura `total_cputime` muito antes — olhar só a contagem
 * de chamadas deixaria a conta ser bloqueada por uma consulta só.
 *
 * Cabeçalho ausente ou ilegível devolve zero: a Meta nem sempre manda, e
 * tratar ausência como "cheio" pararia o painel sem motivo.
 */
export function lerUso(cabecalho: string | null): UsoDaConta {
  if (!cabecalho) return SEM_USO;

  let bruto: unknown;
  try {
    bruto = JSON.parse(cabecalho);
  } catch {
    return SEM_USO;
  }

  if (!ehObjeto(bruto)) return SEM_USO;

  let percentual = 0;
  let bloqueadoPor = 0;

  for (const entradas of Object.values(bruto)) {
    if (!Array.isArray(entradas)) continue;

    for (const entrada of entradas) {
      if (!ehObjeto(entrada)) continue;

      for (const campo of ['call_count', 'total_cputime', 'total_time']) {
        const valor = entrada[campo];
        if (typeof valor === 'number' && valor > percentual) percentual = valor;
      }

      const espera = entrada.estimated_time_to_regain_access;
      if (typeof espera === 'number' && espera > bloqueadoPor) {
        bloqueadoPor = espera;
      }
    }
  }

  return {
    percentual,
    bloqueadoPor,
    acimaDoTeto: percentual >= TETO_DE_USO || bloqueadoPor > 0,
  };
}
