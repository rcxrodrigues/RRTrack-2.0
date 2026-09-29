import 'server-only';

import { criarClienteAdmin } from '@/lib/supabase/admin';

/**
 * Rate limiting em Postgres, sem Redis.
 *
 * A conta é feita no banco por uma função atômica (`INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING`): duas requisições simultâneas não conseguem ler o
 * mesmo contador e ambas passarem, que é o furo clássico de um
 * SELECT-depois-UPDATE.
 */

export type Limite = { requisicoes: number; janelaSegundos: number };

/** Generoso para uma pessoa navegando, apertado para um script. */
export const LIMITE_CAPTURA: Limite = { requisicoes: 60, janelaSegundos: 60 };

/** O webhook é chamado pela plataforma de venda, não por um navegador. */
export const LIMITE_WEBHOOK: Limite = { requisicoes: 120, janelaSegundos: 60 };

/**
 * O link de acesso por e-mail. Apertado de propósito, e por um motivo que
 * não é o de sempre.
 *
 * Aqui o recurso escasso não é CPU nossa — é a COTA DE E-MAIL. O SMTP do
 * Supabase tem um teto baixo por hora, e quem martelar esta porta o queima:
 * aí quem não consegue entrar no painel é o dono, exatamente quando precisa.
 * O `shouldCreateUser: false` impede criar conta e a resposta idêntica
 * impede descobrir quem tem acesso — nenhum dos dois impede esgotar a cota.
 *
 * Cinco em dez minutos é folgado para quem errou o e-mail ou não achou a
 * mensagem, e fecha a porta para um script.
 */
export const LIMITE_LOGIN: Limite = { requisicoes: 5, janelaSegundos: 600 };

export async function dentroDoLimite(
  bucket: string,
  { requisicoes, janelaSegundos }: Limite,
): Promise<boolean> {
  try {
    const { data, error } = await criarClienteAdmin().rpc('check_rate_limit', {
      p_bucket: bucket,
      p_limit: requisicoes,
      p_window_seconds: janelaSegundos,
    });

    if (error) throw new Error(error.message);
    return data !== false;
  } catch (erro) {
    console.error(
      '[ratelimit] falhou:',
      erro instanceof Error ? erro.message : erro,
    );
    // Deixa passar quando o próprio limitador falha. A escolha é deliberada:
    // um problema no banco não deveria derrubar a captura do site inteiro, e
    // estes endpoints gravam dados — não expõem nem apagam nada.
    return true;
  }
}

/** O bucket de um IP num endpoint. Sem IP, todos caem no mesmo balde. */
export function bucketPorIp(endpoint: string, ip: string | null): string {
  return `${endpoint}:${ip ?? 'sem-ip'}`;
}
