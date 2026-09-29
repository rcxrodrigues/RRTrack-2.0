import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O envio do link de acesso é endpoint PÚBLICO — Server Action é um POST que
 * qualquer um alcança sabendo o id, sem passar pelo layout do painel.
 *
 * O recurso escasso aqui não é CPU: é a COTA DE E-MAIL. O SMTP do Supabase
 * tem teto baixo por hora — o próprio código já tratava
 * `over_email_send_rate_limit` —, e quem martelar esta porta o queima. Aí
 * quem fica de fora do painel é o dono.
 *
 * `shouldCreateUser: false` impede criar conta; a resposta idêntica impede
 * descobrir quem tem acesso. Nenhum dos dois impede esgotar a cota, e por um
 * tempo não havia nada que impedisse.
 *
 * São DOIS baldes e o teste prova os dois separados, porque um só deixaria
 * metade da porta aberta: por IP pega o script daqui, por e-mail pega o
 * ataque distribuído contra uma caixa só.
 */

const LIMITE = 5;

/** Contador por balde, como o do Postgres — mas em memória. */
let contagem = new Map<string, number>();
const enviados: string[] = [];

vi.mock('@/lib/ratelimit', () => ({
  LIMITE_LOGIN: { requisicoes: LIMITE, janelaSegundos: 600 },
  dentroDoLimite: (balde: string) => {
    const n = (contagem.get(balde) ?? 0) + 1;
    contagem.set(balde, n);
    return Promise.resolve(n <= LIMITE);
  },
}));

let ipAtual = '200.100.50.1';

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(
      new Map([
        ['x-forwarded-for', ipAtual],
        ['host', 'track.transforlar.com'],
        ['x-forwarded-proto', 'https'],
      ]),
    ),
  cookies: () => Promise.resolve({ set: () => {} }),
}));

vi.mock('@/lib/supabase/server', () => ({
  criarClienteServidor: () =>
    Promise.resolve({
      auth: {
        signInWithOtp: ({ email }: { email: string }) => {
          enviados.push(email);
          return Promise.resolve({ error: null });
        },
      },
    }),
}));

const { enviarLinkDeAcesso } = await import('./actions');

const INICIAL = { status: 'inicial' as const };

function pedir(email: string) {
  const form = new FormData();
  form.set('email', email);
  return enviarLinkDeAcesso(INICIAL, form);
}

beforeEach(() => {
  contagem = new Map();
  enviados.length = 0;
  ipAtual = '200.100.50.1';
});

describe('enviarLinkDeAcesso', () => {
  it('envia enquanto está dentro do limite', async () => {
    const resposta = await pedir('dono@transforlar.com');
    expect(resposta.status).toBe('enviado');
    expect(enviados).toEqual(['dono@transforlar.com']);
  });

  it('corta o script que martela do mesmo IP, mesmo variando o e-mail', async () => {
    for (let i = 0; i < LIMITE; i += 1) {
      const dentro = await pedir(`alvo${i}@exemplo.com`);
      expect(dentro.status).toBe('enviado');
    }

    const fora = await pedir('alvo-novo@exemplo.com');
    expect(fora.status).toBe('erro');
    expect(enviados).toHaveLength(LIMITE);
  });

  it('corta o ataque distribuído contra UMA caixa — é ela que queima a cota', async () => {
    // Cada tentativa de um IP diferente: o balde por IP nunca enche, e sem o
    // balde por e-mail todas passariam.
    for (let i = 0; i < LIMITE; i += 1) {
      ipAtual = `200.100.50.${i + 10}`;
      const dentro = await pedir('dono@transforlar.com');
      expect(dentro.status).toBe('enviado');
    }

    ipAtual = '200.100.50.99';
    const fora = await pedir('dono@transforlar.com');
    expect(fora.status).toBe('erro');
    expect(enviados).toHaveLength(LIMITE);
  });

  it('trata maiúsculas como o mesmo e-mail, senão o balde se esvazia sozinho', async () => {
    for (let i = 0; i < LIMITE; i += 1) {
      ipAtual = `200.100.50.${i + 10}`;
      await pedir('Dono@Transforlar.com');
    }

    ipAtual = '200.100.50.99';
    const fora = await pedir('dono@transforlar.com');
    expect(fora.status).toBe('erro');
  });

  it('a recusa não diz se o e-mail existe', async () => {
    for (let i = 0; i < LIMITE; i += 1) await pedir('dono@transforlar.com');

    const conhecido = await pedir('dono@transforlar.com');
    const desconhecido = await pedir('ninguem@exemplo.com');

    // Mesmo status e mesma frase: a tela não vira verificador de acesso.
    expect(desconhecido).toEqual(conhecido);
  });
});
