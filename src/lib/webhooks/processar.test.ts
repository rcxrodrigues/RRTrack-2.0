import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ehObjeto } from '@/lib/json';
import type { CompraNormalizada, StatusCompra } from '@/lib/webhooks/tipos';

/**
 * O que acontece com a venda entre o adaptador e os destinos.
 *
 * Duas regras moram aqui e as duas erram em silêncio: gravar um campo vazio
 * por cima de um preenchido apaga o cliente da venda, e disparar antes de
 * casar manda a conversão sem identificação nenhuma — a Meta aceita as duas
 * coisas sem reclamar, e o estrago só aparece no match lá na frente.
 */

/** A sequência real das chamadas, para provar a ORDEM e não só o efeito. */
const ordem: string[] = [];
const upsert = vi.fn();
const update = vi.fn();
const buscas: { coluna: string; valor: string }[] = [];
/** O estado que sobrevive entre chamadas — é ele que a escada consulta. */
const banco = new Map<string, Record<string, unknown>>();
/** Devolve o visitante para a coluna que a cascata estiver tentando agora. */
const visitantePor = vi.fn<(coluna: string) => unknown>();

vi.mock('@/lib/compras', () => ({
  dispararCompra: (id: string) => {
    ordem.push(`disparar:${id}`);
    return Promise.resolve();
  },
  desfazerCompra: (id: string) => {
    ordem.push(`desfazer:${id}`);
    return Promise.resolve();
  },
}));

/**
 * O cliente falso.
 *
 * Mesma ideia do `compras.test.ts`: o construtor do supabase-js é encadeável
 * e aguardável ao mesmo tempo, então cada elo é uma **Promise de verdade**
 * com os métodos pendurados nela — promessa já tem `then` por natureza, e o
 * lint não reclama de thenable improvisado.
 */
vi.mock('@/lib/supabase/admin', () => {
  function consultaVisitante(): Promise<unknown> {
    const encadeaveis = Object.fromEntries(
      ['gte', 'limit', 'neq', 'not', 'order', 'returns', 'select'].map(
        (metodo) => [metodo, () => consultaVisitante()],
      ),
    );
    return Object.assign(Promise.resolve({ data: [], error: null }), encadeaveis, {
      eq: (coluna: string, valor: string) => {
        buscas.push({ coluna, valor });
        return consultaVisitante();
      },
      maybeSingle: () =>
        Promise.resolve({ data: visitantePor(buscas.at(-1)?.coluna ?? '') }),
    });
  }

  /**
   * O `update` do banco de mentira.
   *
   * `select()` é preguiçoso de propósito: é ele que aplica os filtros, e
   * `.in('status', …)` só é chamado DEPOIS do `.eq(…)`. Aplicar na
   * construção da promessa avaliaria a escada antes de saber qual é.
   */
  function consultaUpdate(valores: Record<string, unknown>) {
    let transactionId: string | undefined;
    let statusAceitos: readonly string[] | undefined;

    function aplicar(): { transaction_id: string }[] {
      if (transactionId === undefined) return [];
      const linha = banco.get(transactionId);
      if (!linha) return [];
      if (statusAceitos && !statusAceitos.includes(String(linha.status))) return [];
      Object.assign(linha, valores);
      return [{ transaction_id: transactionId }];
    }

    const encadeavel = {
      in: (coluna: string, aceitos: readonly string[]) => {
        if (coluna === 'status') statusAceitos = aceitos;
        return encadeavel;
      },
      select: () => Promise.resolve({ data: aplicar(), error: null }),
    };

    return {
      eq: (coluna: string, valor: string) => {
        if (coluna === 'transaction_id') transactionId = valor;
        buscas.push({ coluna, valor });
        ordem.push('casar');
        update(valores);
        // Aguardável direto para o casamento, que não pede `select`.
        return Object.assign(Promise.resolve({ error: null }), encadeavel);
      },
    };
  }

  return {
    criarClienteAdmin: () => ({
      from: () => ({
        select: () => consultaVisitante(),
        upsert: (
          valores: Record<string, unknown>,
          opcoes: { ignoreDuplicates?: boolean },
        ) => {
          ordem.push('upsert');
          upsert(valores, opcoes);
          const id = String(valores.transaction_id);
          const existe = banco.has(id);
          if (!existe) banco.set(id, { ...valores });
          return {
            // O conflito devolve LISTA VAZIA — é assim que o código de
            // verdade sabe se a linha é nova.
            select: () =>
              Promise.resolve({
                data: existe ? [] : [{ transaction_id: id }],
                error: null,
              }),
          };
        },
        update: (valores: Record<string, unknown>) => consultaUpdate(valores),
      }),
    }),
  };
});

const { concluirCompra, gravarCompra } = await import('./processar');

const BASE: CompraNormalizada = {
  plataforma: 'yampi',
  transactionId: 'yampi:1000001',
  evento: 'order.paid',
  status: 'aprovada',
  valor: 199.9,
  moeda: 'BRL',
  trckUserId: null,
  email: null,
  telefone: null,
  primeiroNome: null,
  sobrenome: null,
  produtos: [],
  ipCliente: null,
  ocorridoEm: null,
};

const ID = 'f'.repeat(32);

function compra(campos: Partial<CompraNormalizada> = {}): CompraNormalizada {
  return { ...BASE, ...campos };
}

/** O que foi realmente mandado ao banco na última gravação. */
function gravado(): Record<string, unknown> {
  const [valores] = upsert.mock.calls.at(-1) ?? [];
  return ehObjeto(valores) ? valores : {};
}

function atualizado(): Record<string, unknown> {
  const [valores] = update.mock.calls.at(-1) ?? [];
  return ehObjeto(valores) ? valores : {};
}

/** Como a linha ficou no banco de mentira. */
function noBanco(id = 'yampi:1000001'): Record<string, unknown> {
  return banco.get(id) ?? {};
}

beforeEach(() => {
  banco.clear();
  ordem.length = 0;
  buscas.length = 0;
  upsert.mockClear();
  update.mockClear();
  visitantePor.mockReset();
  visitantePor.mockReturnValue(null);
});

describe('gravarCompra', () => {
  it('não manda campo vazio — o estorno não pode apagar o cliente da aprovação', async () => {
    // O evento de estorno chega sem os dados do cliente que o de aprovação
    // trouxe. Mandar `email: null` no upsert sobrescreveria o e-mail já
    // gravado, e a venda perderia o comprador para sempre.
    await gravarCompra(compra({ status: 'estornada' }), { cru: true });

    const linha = gravado();
    expect(linha).not.toHaveProperty('email');
    expect(linha).not.toHaveProperty('phone');
    expect(linha).not.toHaveProperty('first_name');
    expect(linha).not.toHaveProperty('trck_user_id');
    expect(linha.status).toBe('estornada');
  });

  it('manda o valor ZERO — zero é um número, não é ausência', async () => {
    // Cupom de 100% existe. Um filtro escrito como `if (valor)` derrubaria
    // o campo e a venda ficaria com o valor da mensagem anterior.
    await gravarCompra(compra({ valor: 0 }), null);

    expect(gravado().value).toBe(0);
  });

  it('deduplica por transaction_id, que é por PEDIDO e não por evento', async () => {
    await gravarCompra(compra(), null);

    const [, opcoes] = upsert.mock.calls.at(-1) ?? [];
    // `ignoreDuplicates` é o que faz o conflito devolver lista vazia — é
    // assim que se sabe se a linha é nova, e a escada de status depende
    // dessa distinção.
    expect(opcoes).toEqual({
      onConflict: 'transaction_id',
      ignoreDuplicates: true,
    });
    expect(gravado().transaction_id).toBe('yampi:1000001');
  });

  it('hasheia e-mail e telefone na gravação, e guarda os dois', async () => {
    await gravarCompra(
      compra({ email: 'Ana@Exemplo.com ', telefone: '(11) 98888-7777' }),
      null,
    );

    const linha = gravado();
    expect(linha.email).toBe('Ana@Exemplo.com ');
    expect(linha.email_hash).toMatch(/^[0-9a-f]{64}$/);
    // 11 dígitos entram com o DDI 55 na frente — formulário brasileiro não
    // pede código de país.
    expect(linha.phone_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('grava o IP do COMPRADOR, nunca o da requisição do gateway', async () => {
    await gravarCompra(compra({ ipCliente: '187.1.2.3' }), null);

    expect(gravado().ip).toBe('187.1.2.3');
  });
});

describe('concluirCompra', () => {
  it('casa ANTES de disparar — senão a conversão vai sem identificação', async () => {
    visitantePor.mockReturnValue({ trck_user_id: ID, fbp: 'fb.1.2.3' });

    await concluirCompra(compra({ trckUserId: ID }));

    // A ordem é a regra: é o casamento que copia fbp, fbc e ga_client_id
    // para a linha da compra. Disparar antes mandaria a venda pelada.
    expect(ordem).toEqual(['casar', 'disparar:yampi:1000001', 'desfazer:yampi:1000001']);
  });

  it('chama disparar E desfazer — a ordem dos eventos do gateway não é garantida', async () => {
    // O `order_refund` da Appmax pode chegar antes do `order_approved`.
    // Cada um checa o status por dentro e sai calado quando não é o seu caso.
    await concluirCompra(compra());

    expect(ordem).toContain('disparar:yampi:1000001');
    expect(ordem).toContain('desfazer:yampi:1000001');
  });

  it('tenta o trck_user_id primeiro e para no primeiro que casar', async () => {
    visitantePor.mockImplementation((coluna) =>
      coluna === 'trck_user_id' ? { trck_user_id: ID } : null,
    );

    await concluirCompra(compra({ trckUserId: ID, email: 'ana@exemplo.com' }));

    expect(buscas.map((b) => b.coluna)).toEqual(['trck_user_id', 'transaction_id']);
    expect(atualizado().match_method).toBe('trck_user_id');
  });

  it('cai para o e-mail quando não veio identificador', async () => {
    visitantePor.mockImplementation((coluna) =>
      coluna === 'email_hash' ? { trck_user_id: ID } : null,
    );

    await concluirCompra(compra({ email: 'ana@exemplo.com', telefone: '11988887777' }));

    expect(buscas[0]?.coluna).toBe('email_hash');
    expect(atualizado().match_method).toBe('email');
  });

  it('cai para o telefone só depois do e-mail falhar', async () => {
    visitantePor.mockImplementation((coluna) =>
      coluna === 'phone_hash' ? { trck_user_id: ID } : null,
    );

    await concluirCompra(compra({ email: 'ana@exemplo.com', telefone: '11988887777' }));

    expect(buscas.map((b) => b.coluna)).toEqual([
      'email_hash',
      'phone_hash',
      'transaction_id',
    ]);
    expect(atualizado().match_method).toBe('phone');
  });

  it('copia o geo do VISITANTE, não o do gateway', async () => {
    visitantePor.mockReturnValue({
      trck_user_id: ID,
      geo_country: 'BR',
      geo_region: 'SP',
      geo_city: 'São Paulo',
      fbp: 'fb.1.2.3',
      fbc: 'fb.1.2.abc',
      ga_client_id: '123.456',
    });

    await concluirCompra(compra({ trckUserId: ID }));

    const linha = atualizado();
    expect(linha.geo_city).toBe('São Paulo');
    expect(linha.fbp).toBe('fb.1.2.3');
    expect(linha.ga_client_id).toBe('123.456');
  });

  it('registra "nenhum" quando não casa — órfã é uma resposta, não um vazio', async () => {
    await concluirCompra(compra({ email: 'ninguem@exemplo.com' }));

    const linha = atualizado();
    expect(linha.match_method).toBe('nenhum');
    expect(linha.match_reason).toBe('nenhum visitante bateu com os dados recebidos');
  });

  it('distingue "não casou" de "nem dava para tentar"', async () => {
    // Sem identificador, sem e-mail e sem telefone o casamento nem roda —
    // e o painel precisa saber que o buraco está no checkout, não no match.
    await concluirCompra(compra());

    expect(atualizado().match_reason).toBe(
      'o webhook não trouxe identificador, e-mail nem telefone',
    );
  });

  it('dispara mesmo quando o casamento não acha ninguém', async () => {
    // Venda órfã continua sendo venda: a receita é real e a Meta precisa
    // saber. Só o match é que fica pior.
    await concluirCompra(compra({ email: 'ninguem@exemplo.com' }));

    expect(ordem).toContain('disparar:yampi:1000001');
  });
});

/*
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ A ordem de chegada dos webhooks NÃO é garantida, e todos os gateways   │
 * │ reenviam — a Appmax até quatro vezes. "O último evento vence" erra o   │
 * │ faturamento nos DOIS sentidos, e sempre em silêncio.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Estes testes usam o banco de mentira de verdade: gravam, regravam, e
 * conferem o que sobrou na linha. Ler o código não provaria nada aqui,
 * porque o que decide é um `where` que roda no Postgres.
 */
describe('a escada de status', () => {
  const PEDIDO = 'yampi:1000001';

  async function chegam(...statuses: StatusCompra[]): Promise<unknown> {
    for (const status of statuses) {
      // eslint-disable-next-line no-await-in-loop
      await gravarCompra(compra({ status }), null);
    }
    return noBanco(PEDIDO).status;
  }

  it('o primeiro evento cria a linha com o status dele', async () => {
    expect(await chegam('pendente')).toBe('pendente');
  });

  it('pendente → aprovada: avança', async () => {
    expect(await chegam('pendente', 'aprovada')).toBe('aprovada');
  });

  it('recusada → aprovada: a segunda tentativa de cartão pode dar certo', async () => {
    expect(await chegam('recusada', 'aprovada')).toBe('aprovada');
  });

  it('aprovada → estornada: o dinheiro saiu depois de entrar', async () => {
    expect(await chegam('aprovada', 'estornada')).toBe('estornada');
  });

  it('estornada → chargeback: o mais grave ganha', async () => {
    expect(await chegam('estornada', 'chargeback')).toBe('chargeback');
  });

  /*
   * PERDE RECEITA. Um pedido com duas tentativas de cartão: a primeira
   * recusada, a segunda aprovada. Se a recusa chegar DEPOIS da aprovação, a
   * venda sairia do faturamento — e o ROAS que vale é sobre `aprovada`.
   */
  it('aprovada NÃO volta para recusada — recusa atrasada de outro cartão', async () => {
    expect(await chegam('aprovada', 'recusada')).toBe('aprovada');
  });

  it('aprovada NÃO volta para pendente', async () => {
    expect(await chegam('aprovada', 'pendente')).toBe('aprovada');
  });

  /*
   * INFLA RECEITA, e é o pior dos dois. O estorno chega, o `refund` vai
   * para o GA4 e o `reverted_at` é marcado. Depois o gateway REENVIA o
   * evento de aprovação. Sem a escada, a linha voltaria a `aprovada` com o
   * `reverted_at` preenchido: estado incoerente, e uma venda devolvida ao
   * cliente reaparecendo no faturamento.
   */
  it('estornada NÃO volta para aprovada — o reenvio não ressuscita a venda', async () => {
    expect(await chegam('estornada', 'aprovada')).toBe('estornada');
  });

  it('chargeback NÃO volta para estornada nem para aprovada', async () => {
    expect(await chegam('chargeback', 'estornada')).toBe('chargeback');
    banco.clear();
    expect(await chegam('chargeback', 'aprovada')).toBe('chargeback');
  });

  it('o mesmo evento reenviado não muda nada', async () => {
    expect(await chegam('aprovada', 'aprovada', 'aprovada')).toBe('aprovada');
  });

  /*
   * O status trava; o resto dos dados, não. Um evento atrasado ainda pode
   * trazer o cliente que o anterior não trouxe — e descartá-lo junto com o
   * status perderia informação de graça.
   */
  it('evento que não avança o status AINDA atualiza os outros campos', async () => {
    await gravarCompra(compra({ status: 'aprovada' }), null);
    await gravarCompra(
      compra({ status: 'recusada', email: 'ana@exemplo.com' }),
      null,
    );

    const linha = noBanco(PEDIDO);
    expect(linha.status).toBe('aprovada');
    expect(linha.email).toBe('ana@exemplo.com');
  });

  it('e o campo vazio continua não apagando o que já estava', async () => {
    await gravarCompra(compra({ status: 'aprovada', email: 'ana@exemplo.com' }), null);
    await gravarCompra(compra({ status: 'recusada', email: null }), null);

    expect(noBanco(PEDIDO).email).toBe('ana@exemplo.com');
  });
});
