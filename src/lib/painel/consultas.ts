import 'server-only';

import { numero as numeroEm, texto as textoEm } from '@/lib/json';
import { criarClienteServidor } from '@/lib/supabase/server';

import type { Intervalo } from './periodo';

/**
 * As consultas agregadas do painel.
 *
 * Todas chamam funções do banco (`painel_*`), e por dois motivos: o PostgREST
 * não faz `group by` nem `sum`, e o intervalo precisa ser parâmetro para o
 * fuso não ficar cravado numa view — ver `supabase/migrations/…_consultas_do_painel.sql`.
 *
 * A leitura usa o cliente do USUÁRIO, não o `service_role`. As funções são
 * `stable` e rodam com os privilégios de quem chama, então a RLS de
 * `authenticated` vale igual — é o que queremos: o painel não precisa de
 * poder nenhum além de ler.
 */

export type Resumo = {
  visitantes: number;
  identificados: number;
  eventos: number;
  aprovadas: number;
  receita: number;
  pendentes: number;
  recusadas: number;
  estornadas: number;
  devolvido: number;
  atribuidas: number;
  semAtribuicao: number;
};

export type EventoPorTipo = {
  nome: string;
  total: number;
  visitantes: number;
};

export type PontoDaSerie = {
  /** `YYYY-MM-DD` no fuso pedido. Texto, não `Date`: ver a nota abaixo. */
  dia: string;
  visitantes: number;
  eventos: number;
  aprovadas: number;
  receita: number;
};

export type LinhaGeo = {
  pais: string;
  regiao: string | null;
  visitantes: number;
  aprovadas: number;
  receita: number;
};

const RESUMO_VAZIO: Resumo = {
  visitantes: 0,
  identificados: 0,
  eventos: 0,
  aprovadas: 0,
  receita: 0,
  pendentes: 0,
  recusadas: 0,
  estornadas: 0,
  devolvido: 0,
  atribuidas: 0,
  semAtribuicao: 0,
};

/**
 * Número, ou zero.
 *
 * O PostgREST devolve `numeric` como número JSON, mas não é garantia de
 * versão nem de configuração — e um `NaN` num campo de receita é a pior
 * classe de bug deste projeto: some no cálculo e aparece no relatório.
 */
function num(linha: unknown, campo: string): number {
  const direto = numeroEm(linha, campo);
  if (direto !== undefined) return direto;

  const comoTexto = textoEm(linha, campo);
  if (comoTexto === undefined) return 0;
  const convertido = Number(comoTexto);
  return Number.isFinite(convertido) ? convertido : 0;
}

/**
 * O que veio, como lista.
 *
 * A tipagem do `Database` deste projeto declara `Returns: unknown` para toda
 * função — não há tipos gerados do banco, de propósito, para não haver um
 * arquivo que possa divergir do SQL em silêncio. O preço é narrowar aqui, e
 * é um preço bom: `Array.isArray` não mente sobre o que chegou.
 */
function linhas(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

/** Os parâmetros que toda função do painel recebe. */
function janela(intervalo: Intervalo): { de: string; ate: string } {
  return { de: intervalo.de.toISOString(), ate: intervalo.ate.toISOString() };
}

export async function buscarResumo(intervalo: Intervalo): Promise<Resumo> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .rpc('painel_resumo', janela(intervalo))
    .maybeSingle();

  if (error) {
    console.error('[painel] resumo falhou:', error.message);
    return RESUMO_VAZIO;
  }

  return {
    visitantes: num(data, 'visitantes'),
    identificados: num(data, 'identificados'),
    eventos: num(data, 'eventos'),
    aprovadas: num(data, 'aprovadas'),
    receita: num(data, 'receita'),
    pendentes: num(data, 'pendentes'),
    recusadas: num(data, 'recusadas'),
    estornadas: num(data, 'estornadas'),
    devolvido: num(data, 'devolvido'),
    atribuidas: num(data, 'atribuidas'),
    semAtribuicao: num(data, 'sem_atribuicao'),
  };
}

export async function buscarEventosPorTipo(
  intervalo: Intervalo,
): Promise<EventoPorTipo[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .rpc('painel_eventos_por_tipo', janela(intervalo));

  if (error) {
    console.error('[painel] eventos por tipo falhou:', error.message);
    return [];
  }

  return linhas(data).flatMap((linha) => {
    const nome = textoEm(linha, 'event_name');
    return nome === undefined
      ? []
      : [
          {
            nome,
            total: num(linha, 'total'),
            visitantes: num(linha, 'visitantes'),
          },
        ];
  });
}

export async function buscarSerieDiaria(
  intervalo: Intervalo,
): Promise<PontoDaSerie[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .rpc('painel_serie_diaria', { ...janela(intervalo), fuso: intervalo.fuso });

  if (error) {
    console.error('[painel] série diária falhou:', error.message);
    return [];
  }

  return linhas(data).flatMap((linha) => {
    /*
     * O dia fica TEXTO, não `Date`.
     *
     * O banco já entregou o dia no fuso pedido; virar `Date` o reinterpreta
     * como instante UTC e o rótulo do gráfico voltaria a andar um dia para
     * trás no navegador de quem olha. É a mesma armadilha do
     * `toLocaleString` na hidratação, por outra porta.
     */
    const dia = textoEm(linha, 'dia');
    return dia === undefined
      ? []
      : [
          {
            dia: dia.slice(0, 10),
            visitantes: num(linha, 'visitantes'),
            eventos: num(linha, 'eventos'),
            aprovadas: num(linha, 'aprovadas'),
            receita: num(linha, 'receita'),
          },
        ];
  });
}

export async function buscarGeo(intervalo: Intervalo): Promise<LinhaGeo[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .rpc('painel_geo', janela(intervalo));

  if (error) {
    console.error('[painel] geo falhou:', error.message);
    return [];
  }

  return linhas(data).flatMap((linha) => {
    const pais = textoEm(linha, 'pais');
    return pais === undefined
      ? []
      : [
          {
            pais,
            regiao: textoEm(linha, 'regiao') ?? null,
            visitantes: num(linha, 'visitantes'),
            aprovadas: num(linha, 'aprovadas'),
            receita: num(linha, 'receita'),
          },
        ];
  });
}
