import 'server-only';

import { numero as numeroEm, texto as textoEm } from '@/lib/json';
import { criarClienteServidor } from '@/lib/supabase/server';

import type { ReceitaPorUtm } from './roas';
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

/**
 * Uma cidade, com o mesmo formato da região.
 *
 * A região responde "de onde vem o dinheiro" no atacado; a CIDADE é o que
 * decide frete, prazo e onde a fraude se concentra. Num funil brasileiro
 * "SP" é metade do país — parar na região é parar cedo demais.
 */
export type LinhaCidade = {
  cidade: string;
  regiao: string | null;
  pais: string | null;
  visitantes: number;
  aprovadas: number;
  receita: number;
};

export async function buscarCidades(
  intervalo: Intervalo,
): Promise<LinhaCidade[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc('painel_cidades', janela(intervalo));

  if (error) {
    console.error('[painel] cidades falhou:', error.message);
    return [];
  }

  return linhas(data).flatMap((linha) => {
    const cidade = textoEm(linha, 'cidade');
    return cidade === undefined
      ? []
      : [
          {
            cidade,
            regiao: textoEm(linha, 'regiao') ?? null,
            pais: textoEm(linha, 'pais') ?? null,
            visitantes: num(linha, 'visitantes'),
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

/**
 * A receita aprovada por UTM — o outro lado do ROAS.
 *
 * A campanha vazia agrupa a venda **sem atribuição**, que é receita real
 * fora de campanha nenhuma. Ela vem junto de propósito: sem esse número o
 * ROAS parece pior do que é e ninguém sabe o quanto.
 */
export async function buscarReceitaPorUtm(
  intervalo: Intervalo,
): Promise<ReceitaPorUtm[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc(
    'painel_receita_por_utm',
    janela(intervalo),
  );

  if (error) {
    console.error('[painel] receita por utm falhou:', error.message);
    return [];
  }

  return linhas(data).map((linha) => ({
    campanha: textoEm(linha, 'utm_campaign') ?? '',
    origem: textoEm(linha, 'utm_source') ?? '',
    vendas: num(linha, 'vendas'),
    receita: num(linha, 'receita'),
  }));
}

export type LinhaPagina = {
  url: string;
  visitantes: number;
  checkouts: number;
  compras: number;
  receita: number;
};

/**
 * Conversão por página.
 *
 * A atribuição é "o visitante VIU esta página", então quem passou por três
 * páginas e comprou conta nas três. A soma das colunas não fecha com o total
 * do painel, e a tela diz isso — número que não fecha sem aviso é pior que
 * número nenhum.
 */
export async function buscarPaginas(intervalo: Intervalo): Promise<LinhaPagina[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc('painel_paginas', janela(intervalo));

  if (error) {
    console.error('[painel] páginas falhou:', error.message);
    return [];
  }

  return linhas(data).map((linha) => ({
    url: textoEm(linha, 'url') ?? '',
    visitantes: num(linha, 'visitantes'),
    checkouts: num(linha, 'checkouts'),
    compras: num(linha, 'compras'),
    receita: num(linha, 'receita'),
  }));
}

export type ReceitaPorUtmCompleta = {
  campanha: string;
  conjunto: string;
  anuncio: string;
  origem: string;
  vendas: number;
  receita: number;
};

/**
 * Receita quebrada pelos três níveis da árvore da Meta.
 *
 * A convenção é a das macros do anúncio: `{{campaign.name}}` em
 * `utm_campaign`, `{{adset.name}}` em `utm_term`, `{{ad.name}}` em
 * `utm_content`. Campo vazio significa que a macro não estava no anúncio —
 * e aí o ROAS daquele nível é `—`, não zero.
 */
export async function buscarReceitaPorUtmCompleta(
  intervalo: Intervalo,
): Promise<ReceitaPorUtmCompleta[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc(
    'painel_receita_por_utm_completa',
    janela(intervalo),
  );

  if (error) {
    console.error('[painel] receita por utm completa falhou:', error.message);
    return [];
  }

  return linhas(data).map((linha) => ({
    campanha: textoEm(linha, 'utm_campaign') ?? '',
    conjunto: textoEm(linha, 'utm_term') ?? '',
    anuncio: textoEm(linha, 'utm_content') ?? '',
    origem: textoEm(linha, 'utm_source') ?? '',
    vendas: num(linha, 'vendas'),
    receita: num(linha, 'receita'),
  }));
}
