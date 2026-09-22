/**
 * A forma única que toda venda assume depois de normalizada.
 *
 * Cada gateway fala o seu dialeto — centavos ou reais, status em português ou
 * em inglês, cliente dentro do pedido ou num evento à parte. Tudo isso morre
 * no adaptador; daqui para dentro do sistema existe só esta forma.
 */

/**
 * O que a venda significa para o faturamento.
 *
 * Deliberadamente pequeno: o gateway tem dezenas de eventos, e o painel
 * precisa de cinco respostas. O evento original continua guardado em
 * `evento`, para auditoria.
 */
export type StatusCompra =
  | 'aprovada'
  | 'pendente'
  | 'recusada'
  /** Devolvida ao cliente — DESFAZ receita já contada. */
  | 'estornada'
  /** Contestada no cartão — também desfaz. */
  | 'chargeback';

/** Status que tiram dinheiro do caixa depois de já terem entrado. */
export const STATUS_QUE_DESFAZEM: readonly StatusCompra[] = ['estornada', 'chargeback'];

export type ProdutoComprado = {
  id: string | null;
  nome: string | null;
  /** Em unidade de moeda, nunca em centavos. */
  preco: number | null;
  quantidade: number;
};

export type CompraNormalizada = {
  /** `appmax`, `pagou`, `millionspay`… */
  plataforma: string;

  /**
   * Único e estável por PEDIDO, não por evento.
   *
   * Um pedido de cartão dispara quatro eventos com o mesmo número; é uma
   * venda só e tem de virar uma linha só. Vai prefixado pela plataforma
   * porque `3531` da Appmax e `3531` da Pagou não são o mesmo pedido.
   */
  transactionId: string;

  /** O evento original do gateway, palavra por palavra. Para auditoria. */
  evento: string;

  status: StatusCompra;

  /** Em unidade de moeda (reais), nunca em centavos. */
  valor: number | null;
  moeda: string;

  /** O vínculo com a visita, quando o checkout repassa. */
  trckUserId: string | null;

  email: string | null;
  telefone: string | null;
  primeiroNome: string | null;
  sobrenome: string | null;

  produtos: ProdutoComprado[];

  /**
   * O IP do COMPRADOR, quando o gateway informa.
   *
   * Nunca o da requisição do webhook: aquele é o do servidor do gateway.
   * Usá-lo marcaria toda venda com o datacenter dele — e, pior, mandaria
   * esse IP para a Conversions API, onde ele só atrapalha o match.
   */
  ipCliente: string | null;

  /** Quando a venda aconteceu, se o gateway informar. ISO-8601. */
  ocorridoEm: string | null;
};

export type Adaptador = {
  nome: string;

  /**
   * Reconhece o formato pelo FORMATO, não por configuração.
   *
   * Um endpoint só recebe todos os gateways, e pedir para o usuário declarar
   * qual é qual no painel seria mais uma coisa para ele errar às três da
   * manhã. A assinatura do envelope de cada gateway é distinta o bastante.
   */
  reconhece(corpo: unknown): boolean;

  /**
   * Traduz. Devolve `null` quando o evento não interessa ao faturamento —
   * cliente criado, produto de assinatura alterado, e assim por diante.
   * Ignorar não é erro: é a maioria dos eventos.
   */
  normalizar(corpo: unknown): CompraNormalizada | null;

  /**
   * Confere a assinatura do gateway — quando ele assina.
   *
   * Ausente significa "este gateway não assina", e aí só o token da URL
   * protege. Hoje: a Appmax declara que não envia assinatura nenhuma, o
   * OpenAPI da Pagou não documenta, e a MillionsPay gera um secret
   * HMAC-SHA256 por endpoint.
   *
   * ⚠️ **NENHUM adaptador implementa isto ainda, e a rota não chama.** Quem
   * autentica o webhook hoje é o token, nos três lugares onde ele é aceito.
   * Está declarado porque o contrato é o que faz a rota preservar o corpo
   * cru — sem isso, a verificação seria impossível de acrescentar depois.
   * Ligar exige duas coisas que não temos: a fórmula exata de cada gateway
   * (errar recusa 100% dos webhooks com 401, e a venda some) e um lugar no
   * cofre para o secret de cada um.
   *
   * Recebe o corpo CRU, em texto. Não é capricho: HMAC é sobre os bytes
   * exatos que chegaram, e `JSON.parse` seguido de `JSON.stringify` muda
   * espaçamento e ordem de chaves — a assinatura nunca bateria.
   */
  verificarAssinatura?(entrada: {
    corpoCru: string;
    headers: Headers;
    segredo: string;
  }): boolean;
};

/** Centavos inteiros para unidade de moeda, com duas casas exatas. */
export function deCentavos(centavos: unknown): number | null {
  return typeof centavos === 'number' && Number.isFinite(centavos)
    ? Math.round(centavos) / 100
    : null;
}
