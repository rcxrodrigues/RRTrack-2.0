import { createHash, timingSafeEqual } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';

import { extrairGeo } from '@/lib/geo';
import { carregarConfiguracao } from '@/lib/settings';
import { bucketPorIp, dentroDoLimite, LIMITE_WEBHOOK } from '@/lib/ratelimit';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { lerWebhook } from '@/lib/webhooks';
import { concluirCompra, gravarCompra } from '@/lib/webhooks/processar';

/** Este endpoint grava; nunca deve ser pré-renderizado nem cacheado. */
export const dynamic = 'force-dynamic';

/**
 * O webhook de compra.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ A Appmax dá 5 SEGUNDOS para responder 200. Estourou, ela reenvia — e  │
 * │ depois de 4 tentativas descarta em definitivo, sem avisar ninguém.    │
 * │                                                                       │
 * │ Por isso a rota responde ANTES de trabalhar. Casar a venda, enviar    │
 * │ para a Meta e para o GA4 acontece em `after()`. Fazer isso dentro da  │
 * │ requisição seria apostar a venda contra a latência da rede.           │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Autenticação: o token vai na URL. Não é preferência — a Appmax **não envia
 * header de assinatura nem token** (ver `docs/gateways/appmax.md`), e a URL é
 * o único lugar onde um segredo cabe.
 */

/** O maior corpo que aceitamos. Ver a nota no `POST`. */
const TETO_DO_CORPO = 1_000_000;

/**
 * Cabeçalhos em que algum gateway manda o token.
 *
 * Cresce quando um gateway novo inventa o seu. A Adoorei chama o dela de
 * "hash" e é token puro — descobrir isso tarde custaria 401 em toda venda.
 */
const CABECALHOS_DE_TOKEN = [
  'x-webhook-token',
  'x-adoorei-hash',
] as const;

function primeiroCabecalho(
  headers: Headers,
  nomes: readonly string[],
): string | null {
  for (const nome of nomes) {
    const valor = headers.get(nome)?.trim();
    if (valor) return valor;
  }
  return null;
}

/**
 * Os cabeçalhos guardados para auditoria, SEM o token.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O token do webhook chega num cabeçalho, e a linha de auditoria é lida    │
 * │ pelo painel e impressa na tela. Gravá-lo cru seria segredo em repouso    │
 * │ numa coluna nossa — exatamente o que o Vault existe para evitar, e a     │
 * │ mesma armadilha que o `payload_meta` já desvia por outra porta.          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O mascaramento é por VALOR, não por nome. A lista de nomes cresce a cada
 * gateway novo — já são três mais o `authorization` — e esquecer um seria
 * silencioso. Comparar contra o token configurado pega qualquer cabeçalho que
 * o carregue, inclusive o que um gateway futuro inventar.
 *
 * O NOME fica sempre, e é ele que tem o valor de diagnóstico: é assim que se
 * descobre como cada gateway assina. As assinaturas HMAC também ficam — são
 * resumo de um payload só, não segredo reutilizável, e são o que falta para
 * fechar as fórmulas da Yampi e da MillionsPay.
 */
const OCULTO = '(oculto: carregava o token)';

export function cabecalhosSeguros(
  headers: Headers,
  token: string,
): Record<string, string> {
  // Token curto demais casaria por acaso e mascararia tudo.
  const comparavel = token.length >= 8 ? token : null;
  const saida: Record<string, string> = {};

  for (const [nome, valor] of headers.entries()) {
    const chave = nome.toLowerCase();
    const carrega =
      chave === 'authorization' ||
      chave === 'proxy-authorization' ||
      chave === 'cookie' ||
      (comparavel !== null && valor.includes(comparavel));

    saida[nome] = carrega ? OCULTO : valor;
  }

  return saida;
}

/** Resposta sem corpo útil: quem chama é robô, não navegador. */
function responder(status: number, corpo: Record<string, unknown>): NextResponse {
  return NextResponse.json(corpo, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Compara em tempo constante.
 *
 * Um `===` vaza o tamanho do prefixo correto pelo tempo de resposta, e com
 * requisições suficientes isso reconstrói o token caractere a caractere. O
 * SHA-256 antes serve para os buffers terem sempre o mesmo tamanho — o
 * `timingSafeEqual` lança se receber tamanhos diferentes, e essa exceção
 * seria, ela mesma, o vazamento.
 */
function tokenConfere(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const geo = extrairGeo(request.headers);

  if (!(await dentroDoLimite(bucketPorIp('webhook', geo.ip), LIMITE_WEBHOOK))) {
    return responder(429, { erro: 'muitas requisições' });
  }

  const supabase = criarClienteAdmin();

  /*
   * O token vem de ONDE cada gateway resolveu mandar, e nenhum deles deixa
   * escolher:
   *
   *   ?token=…                    Appmax e Pagou (não mandam header nenhum)
   *   Authorization: Bearer …     a Zedy documenta assim
   *   X-Adoorei-hash: …           a Adoorei manda aqui — e o nome engana:
   *                               "hash" é o TOKEN do cadastro, comparado por
   *                               igualdade. Não há fórmula, algoritmo nem
   *                               assinatura sobre o corpo em lugar nenhum
   *                               da doc dela.
   *   x-webhook-token: …          alternativa genérica, para quem não deixa
   *                               pôr query string no campo de URL
   *
   * Aceitar todos é o que permite um endpoint só atender a todos. Não
   * enfraquece nada: a comparação é sempre contra o mesmo token configurado,
   * em tempo constante — mais portas de entrada não tornam a fechadura pior.
   */
  const autorizacao = request.headers.get('authorization') ?? '';
  const recebido =
    request.nextUrl.searchParams.get('token') ??
    primeiroCabecalho(request.headers, CABECALHOS_DE_TOKEN) ??
    (autorizacao.toLowerCase().startsWith('bearer ')
      ? autorizacao.slice(7).trim()
      : '');

  const { data: esperado } = await supabase.rpc('get_webhook_token');

  if (typeof esperado !== 'string' || esperado.length === 0) {
    console.error('[webhook] nenhum token gerado no painel — recusando tudo');
    return responder(401, { erro: 'nao autorizado' });
  }

  if (recebido.length === 0 || !tokenConfere(recebido, esperado)) {
    console.warn('[webhook] token inválido');
    return responder(401, { erro: 'nao autorizado' });
  }

  /*
   * Lido como TEXTO, não como JSON.
   *
   * Parece detalhe e não é: HMAC assina os bytes exatos que chegaram. Um
   * `request.json()` descarta o texto original, e reconstruí-lo com
   * `JSON.stringify` muda espaçamento e ordem de chaves — a assinatura
   * nunca mais bateria. A MillionsPay assina (HMAC-SHA256 por endpoint),
   * então o corpo cru precisa sobreviver até a verificação.
   */
  const corpoCru = await request.text().catch(() => '');

  /*
   * Teto de tamanho, e ele faltava.
   *
   * O token já barra quem não deveria estar aqui — mas um gateway com bug,
   * ou um payload com um PDF em base64 dentro, chegaria inteiro: seria
   * parseado, gravado em `webhooks_recebidos` e replicado em
   * `purchases.raw_webhook`. Um corpo de 50 MB vira 100 MB de banco por
   * webhook, e a tabela de auditoria é justamente a que ninguém olha
   * crescer.
   *
   * 1 MB é folgado: o maior payload real que vimos (Appmax, pedido com
   * vários produtos) não passa de 20 KB. 413 e não 202 de propósito —
   * reenviar o mesmo corpo gigante falharia igual, e o gateway precisa
   * saber que o problema é o tamanho.
   */
  if (corpoCru.length > TETO_DO_CORPO) {
    console.warn('[webhook] corpo grande demais:', corpoCru.length, 'bytes');
    return responder(413, { erro: 'corpo grande demais' });
  }

  let corpo: unknown = null;
  try {
    corpo = corpoCru.length > 0 ? JSON.parse(corpoCru) : null;
  } catch {
    console.warn('[webhook] corpo não é JSON válido');
    return responder(202, { recebido: true, tratado: false });
  }

  /*
   * O contexto do painel entra AQUI, antes de interpretar.
   *
   * Os aliases de status da Yampi são configuráveis por loja, então o mapa
   * não pode morar no código. A leitura é cacheada (60s), e o custo perto
   * dos 5 segundos que a Appmax dá é desprezível.
   */
  const { settings } = await carregarConfiguracao();
  const leitura = lerWebhook(corpo, { statusPorAlias: settings.statusPorAlias });

  /*
   * Grava ANTES de interpretar, sempre.
   *
   * Sem isto, um checkout cujo adaptador ainda não existe levava 202 e o
   * payload era DESCARTADO — a venda sumia e ninguém ficava sabendo. Agora
   * fica guardado inteiro: dá para reprocessar quando o adaptador chegar, e
   * o formato real aparece no painel, que é como se escreve o adaptador
   * certo — contra o payload que chegou, não contra documentação.
   */
  const adaptador = leitura.tipo === 'desconhecido' ? null : leitura.adaptador;
  const transactionId = leitura.tipo === 'venda' ? leitura.compra.transactionId : null;
  const motivo = leitura.tipo === 'indeciso' ? leitura.motivo : null;
  after(async () => {
    await registrarRecebido({
      corpo,
      corpoCru,
      headers: request.headers,
      ip: geo.ip,
      adaptador,
      transactionId,
      motivo,
      token: esperado,
    });
  });

  if (leitura.tipo === 'desconhecido') {
    // 202 e não 400: o gateway reenviaria 4 vezes um payload que nós não
    // sabemos ler, e as quatro falhariam igual. Fica registrado no log.
    console.warn('[webhook] formato não reconhecido por nenhum adaptador');
    return responder(202, { recebido: true, tratado: false });
  }

  if (leitura.tipo === 'ignorado') {
    return responder(200, { recebido: true, tratado: false });
  }

  if (leitura.tipo === 'indeciso') {
    /*
     * Reconhecido, e não soubemos o que fazer. 200 e não 500: o retry do
     * gateway falharia as quatro vezes igual, porque o que falta é
     * cadastro nosso, não sorte na rede. O motivo já foi gravado e aparece
     * no painel — é lá que isto se resolve, e depois se reprocessa.
     */
    console.warn('[webhook]', leitura.adaptador, 'indeciso:', leitura.motivo);
    return responder(200, { recebido: true, tratado: false });
  }

  const { compra } = leitura;

  try {
    await gravarCompra(compra, corpo);
  } catch (erro) {
    console.error(
      '[webhook] falha ao gravar:',
      erro instanceof Error ? erro.message : erro,
    );
    // 500 DE PROPÓSITO: aqui o retry do gateway é exatamente o que queremos.
    // Responder 200 numa falha nossa perderia a venda para sempre.
    return responder(500, { erro: 'nao foi possivel registrar' });
  }

  // Depois da resposta — os 5 segundos são do gateway, não nossos.
  after(async () => {
    await concluirCompra(compra);
  });

  return responder(200, { recebido: true, tratado: true });
}

/**
 * Guarda o webhook cru, reconhecido ou não.
 *
 * Roda em `after()` porque o gateway tem pressa (5s na Appmax) e este
 * registro é auditoria, não caminho crítico. Falhar aqui nunca derruba o
 * processamento da venda.
 */
async function registrarRecebido({
  corpo,
  corpoCru,
  headers,
  ip,
  adaptador,
  transactionId,
  motivo,
  token,
}: {
  corpo: unknown;
  corpoCru: string;
  headers: Headers;
  ip: string | null;
  adaptador: string | null;
  transactionId: string | null;
  motivo: string | null;
  token: string;
}): Promise<void> {
  try {
    await criarClienteAdmin().from('webhooks_recebidos').insert({
      adaptador,
      // Por que não virou venda. Distingue "ignorei de propósito" de
      // "não soube ler" — o segundo é venda possivelmente perdida.
      motivo,
      corpo: corpo ?? null,
      // Guardado só quando NÃO é JSON: payload quebrado também é informação.
      corpo_texto: corpo === null ? corpoCru.slice(0, 20_000) : null,
      // É aqui que se descobre como o gateway assina — o header da
      // MillionsPay e o X-Adoorei-hash aparecem neste objeto. O NOME de
      // todos fica; o valor que carregava o token, não.
      headers: cabecalhosSeguros(headers, token),
      ip,
      transaction_id: transactionId,
    });
  } catch (erro) {
    console.error(
      '[webhook] não consegui registrar o recebido:',
      erro instanceof Error ? erro.message : erro,
    );
  }
}
