# Zedy — webhooks (doc oficial, recebida em 22/09/2026)

> Fonte: `app.zedy.com.br/docs#webhooks`, colada pelo usuário. O domínio é
> inacessível do ambiente (`EGRESS_BLOCKED`).

## Envelope PLANO

Nada de `data`, `resource` ou embrulho — os campos ficam no topo. Isso já a
separa das outras quatro.

```json
{
  "eventType": "ORDER_PAID",
  "orderId": "Z-13CEM05RWG261",
  "platform": "ZedyCheckout",
  "currency": "BRL",
  "paymentMethod": "pix",
  "status": "paid",
  "customer": { "name": "…", "email": "…", "phone": "…", "document": "…", "ip": "…" },
  "products": [{ "id": 1, "name": "…", "quantity": 1, "priceInCents": 9700 }],
  "trackingParameters": { "src": null, "sck": null, "utm_source": "…", "…": "…" },
  "commission": { "totalPriceInCents": 9700, "gatewayFeeInCents": 300, "userCommissionInCents": 9400 },
  "isTest": false
}
```

## Autenticação: `Authorization: Bearer <token>`

Diferente das outras: a Zedy manda o token em **header**, não na URL.

> *"o token do webhook é enviado no header `Authorization: Bearer <token>`.
> Valide-o no seu servidor."*

A rota passou a aceitar os três lugares — `?token=`, `x-webhook-token` e
`Authorization: Bearer` — porque cada gateway escolheu o seu.

## Valores: CENTAVOS

`priceInCents` e `totalPriceInCents`. A unidade está no nome do campo, o que
ajuda.

**O total do pedido é `commission.totalPriceInCents`** — o bruto, o que o
cliente pagou. `userCommissionInCents` é o líquido, já sem a taxa: usá-lo
faria o ROAS parecer menor do que é e a campanha ser cortada à toa.

## Status manda, não o evento

A doc é explícita:

> *"A ordem de chegada dos eventos não é garantida. Use o `status` do payload
> como fonte de verdade, não a sequência."*

| status | nosso |
|---|---|
| `paid` | aprovada |
| `waiting_payment` | pendente |
| `refused` | recusada |
| `refunded` | estornada |

## Eventos

| `eventType` | quando |
|---|---|
| `ORDER_CREATED` | cliente preencheu os dados; ainda não pagou |
| `ORDER_PAID` | pagamento confirmado |
| `ORDER_REFUSED` | recusado ou cancelado pelo gateway |
| `CART_ABANDONED` | 15 min depois de preencher sem tentar pagar |
| `PIX_CREATED` | Pix gerado, aguardando pagamento |
| `BILLET_CREATED` | 15 min depois de gerar boleto sem pagar |

Pegadinha da própria doc: quem gerou Pix ou boleto **não** vem como
`CART_ABANDONED` — vem como `PIX_CREATED`/`BILLET_CREATED`. Marcar só
"carrinho abandonado" no painel deixaria esses casos de fora.

## `isTest` — pedido de teste NÃO vira conversão

Mandar um teste à Meta como `Purchase` ensina o otimizador a perseguir venda
que não existe, e infla o faturamento do painel. O adaptador descarta, com
aviso no log; o payload fica em `webhooks_recebidos`, então nada se perde.

## A ponte da atribuição: `src` e `sck`

`trackingParameters` traz as cinco UTMs **e** dois campos genéricos, `src` e
`sck`. É neles que o `trck_user_id` cabe — o equivalente ao `informations` da
Pagou e ao `metadata` da Yampi.

## Entrega e retentativa

- Responder **2xx em até 5 segundos** (igual à Appmax).
- Até **3 retentativas**, com 1 minuto de intervalo.
- Uma entrega por evento por endpoint, por pedido — mas a doc recomenda
  deduplicar por `orderId + eventType` mesmo assim.
- `orderId` é o token do checkout, único por pedido.
