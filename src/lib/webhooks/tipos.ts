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

/** Os cinco, para validar o que vem do cadastro do painel. */
export const STATUS_COMPRA: readonly StatusCompra[] = [
  'aprovada',
  'pendente',
  'recusada',
  'estornada',
  'chargeback',
];

/**
 * Confere se o texto é um dos cinco.
 *
 * Aceitar texto livre aqui deixaria um status inventado atravessar até a
 * Meta e virar conversão errada — e o cadastro do painel é digitado à mão.
 */
export function ehStatusCompra(valor: string): valor is StatusCompra {
  return (STATUS_COMPRA as readonly string[]).includes(valor);
}

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

/**
 * O adaptador reconheceu o payload e **não soube o que fazer com ele**.
 *
 * Diferente de `null`, que é "reconheci e ignorei de propósito" — nota
 * fiscal, cliente criado, evento que não mexe em dinheiro. Aqueles são a
 * maioria e são normais.
 *
 * Isto é o outro caso: o formato era nosso, o evento parecia importar, e
 * faltou informação para decidir. Até existir esta distinção os dois ficavam
 * IGUAIS no painel — badge verde com o nome do adaptador —, e uma venda
 * possivelmente perdida se escondia atrás da aparência de tratada.
 */
export type Indeciso = { indeciso: true; motivo: string };

export function indeciso(motivo: string): Indeciso {
  return { indeciso: true, motivo };
}

/**
 * A venda, ou `null` — o `Indeciso` vira `null`.
 *
 * Para quem só quer saber se virou venda e não precisa do motivo. Quem
 * precisa é `lerWebhook`, que traduz o motivo para o painel.
 */
export function soVenda(
  lido: CompraNormalizada | Indeciso | null,
): CompraNormalizada | null {
  return lido === null || ehIndeciso(lido) ? null : lido;
}

export function ehIndeciso(valor: unknown): valor is Indeciso {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'indeciso' in valor &&
    valor.indeciso === true
  );
}

/**
 * O que o adaptador precisa do painel para decidir.
 *
 * Existe por causa da Yampi: os aliases de status dela **são configuráveis
 * por loja** (confirmado pelo suporte em 22/09/2026; a lista real vem de
 * `GET /{alias}/checkout/statuses`). Um mapa fixo no código estaria errado
 * por desenho — a loja pode renomear o estorno para `devolvido`, e o refund
 * nunca chegaria ao GA4.
 *
 * É a mesma regra que já vale para a Appmax, por outro caminho: decidir por
 * um campo cuja enumeração ninguém conhece é escolher ser surpreendido.
 */
export type ContextoDoAdaptador = {
  /** `alias` do checkout -> o que ele significa para o faturamento. */
  statusPorAlias: Readonly<Record<string, StatusCompra>>;
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
  normalizar(
    corpo: unknown,
    contexto?: ContextoDoAdaptador,
  ): CompraNormalizada | Indeciso | null;

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
