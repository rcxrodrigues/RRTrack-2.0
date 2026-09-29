import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { hashExternalId } from '@/lib/hash';
import { ehObjeto, texto } from '@/lib/json';

/**
 * O CONTRATO da resposta do `/api/identify`.
 *
 * Este arquivo existe por causa de um furo achado ao verificar outro teste.
 * `snippet-match.test.ts` prova que o navegador PENDURA o `external_id` no
 * Advanced Matching do Pixel — mas ele mocka o `fetch`, então prova apenas
 * o lado de quem consome. Tirando o campo da resposta da rota, os nove
 * testes de lá continuavam passando: ninguém provava que a rota o MANDA.
 *
 * É o mesmo modo de falha que este projeto já viu várias vezes — um lado
 * verificado, o outro por conta da sorte — e a consequência aqui é
 * silenciosa: o Pixel deixa de receber o identificador, a conversão
 * continua chegando, e só a nota de match cai.
 *
 * O `external_id` tem de ser o MESMO hash que vai para a coluna do
 * visitante e daí para a Conversions API. Se a rota devolvesse o id cru, ou
 * um hash calculado de outra forma, a Meta veria dois identificadores
 * diferentes para a mesma pessoa — e não avisa, só casa menos.
 */

const ID = 'b'.repeat(32);

const upsert = vi.fn();

vi.mock('@/lib/captura', async (original) => {
  const real = await original<typeof import('@/lib/captura')>();
  return {
    ...real,
    // O portão (allowlist + rate limit) tem os testes dele; aqui interessa
    // o corpo da resposta, e `responder` segue o de verdade.
    prepararCaptura: () =>
      Promise.resolve({
        ok: true,
        ctx: {
          origem: 'https://minhaloja.com',
          config: {
            settings: {
              currency: 'BRL',
              timezone: 'America/Sao_Paulo',
              testEventCode: null,
              cookieDomain: '.minhaloja.com',
              origensPermitidas: ['https://minhaloja.com'],
              dominiosCheckout: [],
              statusPorAlias: {},
            },
            ga4: [],
            pixels: [],
          },
          geo: { ip: '203.0.113.9', pais: 'BR', regiao: 'BR-MG', cidade: 'Belo Horizonte' },
          cookies: new Map<string, string>(),
          userAgent: 'Mozilla/5.0 (teste)',
        },
      }),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  criarClienteAdmin: () => ({
    from: () => ({
      upsert: (linha: unknown) => {
        upsert(linha);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const { POST } = await import('./route');

function pedido(corpo: Record<string, unknown>) {
  return new NextRequest('https://track.minhaloja.com/api/identify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://minhaloja.com' },
    body: JSON.stringify(corpo),
  });
}

async function responderCom(corpo: Record<string, unknown>) {
  const resposta = await POST(pedido(corpo));
  const lido: unknown = await resposta.json();
  // Lido com os guards de verdade, como o resto do projeto: afirmação de
  // tipo aqui esconderia justamente o caso de o campo não existir.
  return { resposta, corpo: ehObjeto(lido) ? lido : {} };
}

describe('a resposta do /api/identify', () => {
  it('devolve o external_id hasheado, não só o id cru', async () => {
    const { corpo } = await responderCom({ trck_user_id: ID });

    expect(texto(corpo, 'trck_user_id')).toBe(ID);
    expect(texto(corpo, 'external_id')).toBe(hashExternalId(ID));
    // O que o Pixel precisa é o HASH; o id cru ele já tem no cookie.
    expect(texto(corpo, 'external_id')).not.toBe(ID);
    expect(texto(corpo, 'external_id')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('é o MESMO hash que foi para a coluna do visitante', async () => {
    const { corpo } = await responderCom({ trck_user_id: ID });

    // Calculado uma vez e usado nos dois lugares. Hashear em dois lugares é
    // garantir que um dia divergem, e aí a Meta vê duas pessoas.
    const gravado: unknown = upsert.mock.calls.at(-1)?.[0];
    expect(texto(gravado, 'external_id_hash')).toBe(texto(corpo, 'external_id'));
  });

  it('devolve o external_id mesmo quando a gravação falha', async () => {
    // A rota já devolvia o `trck_user_id` nesse caminho de propósito: sem
    // ele o site não pendura o vínculo nos links e a venda chega órfã. O
    // external_id segue a mesma lógica — perder a linha é ruim, perder a
    // identificação do Pixel também.
    upsert.mockImplementationOnce(() => {
      throw new Error('banco fora do ar');
    });

    const { corpo } = await responderCom({ trck_user_id: ID });

    expect(corpo.gravado).toBe(false);
    expect(texto(corpo, 'external_id')).toBe(hashExternalId(ID));
  });
});
