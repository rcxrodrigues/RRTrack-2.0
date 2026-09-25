# Pagou.ai — resumo do OpenAPI v2 (recebido em 21/09/2026)

> Fonte: `openapi-v2.json` + guia de integração, colados pelo usuário.
> `developer.pagou.ai` é inacessível do ambiente (`EGRESS_BLOCKED`).

## Três notícias boas — e uma pendência

### 1. TEM SANDBOX, e ele resolve o problema do teste

`https://api.sandbox.pagou.ai`, e mais: existe

```
PUT /v2/transactions/{id}   { "status": "paid" }
```

*"WARNING: This endpoint is available only in the test environment (sandbox)."*

Dá para **forçar qualquer status** da lista — `paid`, `refunded`, `chargedback`
— e ver o webhook correspondente chegar. Sem dinheiro real, sem R$ 1, sem
estorno de verdade. É o teste completo de graça, incluindo o caminho do
estorno, que é o que quase ninguém testa.

### 2. `informations` volta no webhook — é a ponte

Em `POST /v2/transactions`:

```json
"informations": [{ "key": "trck_user_id", "value": "a1b2c3…" }]
```

> *"Custom key/value metadata to attach to the transaction and **echo on the
> webhook**."* — até 50 pares, chave de 64 e valor de 255 caracteres.

**CONFIRMADO em 25/09/2026**, com dois exemplos de payload publicados. Mas a
mesma página traz a condição, e ela importa mais que a confirmação:

> "Só aparece quando você enviou entradas customizadas na criação;
> transações sem elas (ou **criadas por checkout links**) omitem o campo."

**Numa loja que manda o comprador para um link de checkout — que é o caso da
primeira oferta — `informations` não volta.** A ponte documentada some
exatamente no cenário que temos. O que salva é o `attribution` abaixo.

### 3. A Pagou já captura fbp, fbc e UTM no checkout dela

O objeto `attribution` da transação:

| campo | |
|---|---|
| `utm_source` `utm_medium` `utm_campaign` `utm_content` `utm_term` | as cinco UTMs |
| **`fbp`** **`fbc`** | identificadores da Meta, capturados no checkout |
| `gclid` `ttclid` | Google Ads e TikTok |
| `src` `sck` | parâmetros genéricos |
| `checkout_url` `referrer_url` | de onde o comprador veio |

> *"Marketing attribution captured at checkout. **Null for transactions created
> directly through the API**."*

Ou seja: só vem preenchido se a compra passar pelo **checkout hospedado da
Pagou**. Se o checkout for de terceiro, é `null` e o vínculo tem de vir de
`informations`.

## ⚠️ A pendência que decide o desenho

O exemplo de webhook publicado é **mínimo**:

```json
{
  "id": "evt_pay_1001",
  "event": "transaction",
  "data": {
    "event_type": "transaction.paid",
    "id": "018f1f2e-…",
    "status": "paid",
    "correlation_id": "order_1001"
  }
}
```

Sem comprador, sem valor, sem produtos, sem `attribution`, sem `informations`.

**Se for isso mesmo**, o webhook só avisa *"a transação X mudou para Y"*, e
todo o resto exige `GET /v2/transactions/{id}` — o que é coerente com a regra
da própria Pagou: *"Reconcile uncertain states with GET"*.

Consequência para nós: o adaptador da Pagou precisa de **chave de API**
guardada no cofre, ao contrário do da Appmax. É a primeira pergunta da lista
de suporte.

## Autenticação — da API e do webhook

**Da API**, três formas aceitas: `Authorization: Bearer <key>`,
header `apiKey: <key>`, ou Basic (usuário `token`, senha `x`).

**Do webhook: não há nada documentado.** O OpenAPI não descreve assinatura,
header nem token para as notificações. Como na Appmax, o `webhook_token` na
URL é o que temos — e a Pagou ainda aceita `notify_url` por transação, o que
permite carregar o token ali.

## Valores: CENTAVOS

`amount`, `paid_amount`, `refunded_amount`, `products[].price`, `fee.*` — todos
inteiros em centavos. Sem a exceção traiçoeira que a Appmax tem em assinatura.

Há também `fee.net_amount` e `fee.estimated_fee`: o líquido e a taxa. Para
ROAS o que vale é o bruto (`amount`), mas o líquido é o que cai na conta.

## Status — 17 valores

```
authorized  canceled  captured  chargedback  three_ds_required  expired
in_protest  paid  partially_paid  partially_refunded  pending  processing
processed  refunded  med  pre_chargedback  refused
```

Mapeamento para o nosso:

| nosso | da Pagou |
|---|---|
| aprovada | `paid`, `captured`, `processed`, `partially_paid` |
| pendente | `pending`, `processing`, `authorized`, `three_ds_required` |
| recusada | `refused`, `canceled`, `expired` |
| estornada | `refunded`, `partially_refunded` |
| chargeback | `chargedback`, `pre_chargedback`, `in_protest`, `med` |

`med` é o Mecanismo Especial de Devolução do Pix — devolução forçada pelo
banco. Conta como contestação, não como estorno voluntário.

## Eventos de webhook

```
transaction.created   transaction.pending   transaction.paid
transaction.cancelled transaction.refunded  transaction.chargedback
transaction.three_ds_required
```

Roteamento, segundo a própria doc:

- pagamento → `event == "transaction"` + `data.event_type`
- assinatura → `event == "subscription"` + `data.event_type`
- transferência → **`type`** no topo (não `event`) — é payout, não nos interessa

## Idempotência: pelo id do EVENTO, não do recurso

> *"Deduplicate webhooks by top-level event id, not transaction, subscription,
> or transfer id"* — e *"Deduplicating webhooks by resource id"* aparece na
> lista de erros comuns.

Faz sentido: a mesma transação emite `created`, `pending`, `paid`, `refunded`.
Para nós isso significa: a LINHA é uma por transação (o `id` do recurso), mas
o processamento de cada evento distingue pelo `id` do topo.


---

## O payload real (25/09/2026) — e o que ele corrigiu

```json
{
  "id": "evt_pay_1001",
  "event": "transaction",
  "api_version": "v1",
  "data": {
    "id": "018f1f2e-…", "event_type": "transaction.paid",
    "correlation_id": "order_1001", "method": "pix",
    "status": "paid", "amount": 1500, "currency": "BRL",
    "informations": [{ "key": "order_id", "value": "order_1001" }],
    "customer":  { "name": "Ana Souza", "email": "…", "phone": "…" },
    "products":  [{ "id": "…", "title": "…", "unit_price": 1500, "quantity": 1 }],
    "attribution": {
      "utm_source": "instagram", "utm_medium": "cpc", "utm_campaign": "black-friday",
      "utm_content": null, "utm_term": null,
      "fbc": null, "fbp": null, "gclid": null, "ttclid": null,
      "src": null, "sck": null,
      "checkout_url": "…", "referrer_url": "…"
    }
  }
}
```

### O bug que ele pegou: `customer`, não `buyer`

Eu tinha escrito `buyer`, que é o nome no OpenAPI da **criação**. O webhook
manda `customer`. Lendo só `buyer`, **o comprador se perdia inteiro** — sem
e-mail, sem telefone, sem nome.

E isso não seria um detalhe cosmético: numa venda criada por checkout link,
onde `informations` não volta, **o e-mail é a única ponte que sobra**. Toda
venda da Pagou chegaria órfã, e o ROAS por campanha ficaria cego nela.

É por isso que adaptador se escreve contra o payload real, não contra a
leitura de um schema de outro endpoint.

### A Pagou captura `fbp` e `fbc` — nenhum outro dos cinco faz isso

`data.attribution` traz as cinco UTMs, `fbp`, `fbc`, `gclid`, `ttclid`,
`src`, `sck`, `checkout_url` e `referrer_url`.

Isso muda o pior caso do sistema. A **venda órfã** — a que não casa com
visitante nenhum — hoje vai para a Meta sem identificação, e o match é quase
zero. Com o `attribution`, ela vai ao menos com o `fbp`/`fbc` que o checkout
viu.

Duas travas que isso exigiu:

- **`CompraNormalizada.atribuicao`** carrega o que o gateway capturou, e
  `gravarCompra` grava. Os campos vazios são filtrados como todos os outros.
- **O casamento parou de apagar com `null`.** Um visitante casado por e-mail
  pode não ter `fbp`; escrever o nulo dele por cima jogaria fora a única
  identificação que a venda tinha, e a conversão iria para a Meta **pior do
  que iria sem casar**. O vínculo e o motivo continuam escrevendo sempre —
  ali `null` seria "não respondi", não "não sei".

### `src` / `sck` são a segunda ponte, e a que atravessa link de checkout

Parâmetros de URL, então sobrevivem ao redirecionamento. É o plano A quando
o pedido nasce de um link e `informations` não volta.

### Moeda não é sempre BRL

Um dos exemplos publicados está em **MXN**. O adaptador lê `data.currency` e
nunca crava — mas vale saber que a conta do painel tem de respeitar isso.

### Assinatura: não existe, e a doc diz isso

Procura em 99 arquivos-fonte: nenhum header de verificação, nenhum HMAC,
nenhum segredo. A única linha com `signature` em toda a doc diz
**"The public contract exposes no signature"**.

O que a Pagou prescreve como defesa é dedupe pelo `id` de topo e
reconciliação por `GET`. O token na URL é convenção **nossa**, não esquema
dela — e continua sendo a única autenticação possível aqui.
