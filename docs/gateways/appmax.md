# AppMax — webhooks (resumo da doc oficial, recebida em 21/09/2026)

> Fonte: documentação de **Webhooks da Appstore** da Appmax, colada pelo
> usuário. `docs.appmax.com.br` é inacessível do ambiente de desenvolvimento
> (`EGRESS_BLOCKED`), então este arquivo é a referência do projeto.

## ⚠️ Três armadilhas, antes de tudo

### 1. Esta doc pode não ser a que vale para nós

A própria Appmax separa **dois** tipos de webhook, com payloads diferentes:

| | Webhooks da **Appstore** | Webhooks do **Painel** |
|---|---|---|
| quem configura | desenvolvedor do app | **o merchant, no painel da loja** |
| escopo | todos os merchants que instalam o app | só a loja daquele merchant |
| payload | o documentado aqui | *"formato diferente, sem `app_id`"* |

Nós somos **merchant**, não desenvolvedor de app na Appstore. O caminho
natural é o do Painel — e a doc diz, com todas as letras, que o formato é
outro, sem dar qual.

**Consequência:** o adaptador escrito a partir daqui precisa ser confirmado
contra um payload real antes de ir para produção.

### 2. Se o checkout for Yampi, o webhook NÃO CHEGA

Da tabela de troubleshooting da própria Appmax:

> **Webhook não chega (pedido Yampi)** → Webhook suprimido → *"Comportamento
> intencional para pedidos originados da Yampi"*

Se a plataforma de checkout escolhida for a Yampi, a Appmax **não dispara
webhook nenhum** para esses pedidos. Nesse cenário quem notifica a venda tem
de ser a Yampi, e o adaptador é outro.

### 3. Evento de pedido NÃO traz o cliente

O `data` de um evento `order_*` tem `order_id`, valores, produtos e pagamento
— e **nenhum dado do cliente**: sem e-mail, sem telefone, sem `customer_id`.

O e-mail só aparece em `customer_created`, e os eventos de pedido não trazem
nada que os ligue àquele cliente. Só os eventos `payment_*` têm os dois
(`customer_id` + `order_id`), e eles só disparam em autorização com atraso e
em não-autorização — não no fluxo normal.

**Consequência:** o plano B de casar a venda por e-mail **não funciona** com
este payload. A ponte tem de ser `client_key` / `external_key`. Se elas não
vierem preenchidas com o nosso identificador, a venda chega órfã e fica órfã.

---

## Autenticação: não existe

> *"A Appmax não envia header de assinatura (HMAC) ou token de autenticação
> nos webhooks."*

Headers enviados: só `Content-Type: application/json` e `User-Agent: GuzzleHttp/7`.

A recomendação deles é filtrar por IP, validar a estrutura, ou confirmar via
API. **Para nós isso confirma a decisão já tomada:** o `webhook_token` viaja
na URL (`/api/webhook/compra?token=…`), porque é o único lugar onde cabe.

## Envelope

```json
{
  "event": "order_approved",
  "event_type": "order",
  "site_id": "uuid", "app_id": "uuid",
  "client_key": "…", "external_key": "…",
  "data": { },
  "partner_merchant": { "merchant_email": "…", "…": "…" }
}
```

`client_key` e `external_key` aparecem **duas vezes**: no envelope e dentro de
`data`. São os candidatos a carregar o `trck_user_id`.

## Valores: CENTAVOS — com uma exceção traiçoeira

`data.total`, `freight_value`, `merchant_total`, `discount`, `interest` e
`products[].price` vêm em **centavos** (`25990` = R$ 259,90).

**A exceção:** em eventos de assinatura, `products[].price` vem em **reais**
(`100.0`). A mesma chave, unidade diferente, no mesmo gateway. Quem assumir
uma unidade só erra por 100× em algum lugar.

## Status: use o `event`, não o campo `status`

A doc lista **40 eventos** exaustivamente, mas não traz tabela de `status` —
só aparecem `"aprovado"` e `"aguardando_pagamento"` nos exemplos.

Por isso o adaptador decide pelo **`event`**, que é documentado e fechado.

| nosso status | eventos da Appmax |
|---|---|
| aprovada | `order_approved`, `order_paid`, `order_paid_by_pix`, `order_up_sold`, `order_charge_back_gain` |
| pendente | `order_authorized`, `order_pix_created`, `order_billet_created`, `order_pending_integration`, `order_authorized_with_delay`, `payment_authorized_with_delay` |
| recusada | `order_refused_by_risk`, `payment_not_authorized`, `order_pix_expired`, `order_billet_overdue` |
| estornada | `order_refund`, `order_partial_refund` |
| chargeback | `order_chargeback_in_treatment` |
| ignorar | `order_integrated`, `split_orders`, `customer_*`, `subscription_*` |

`order_charge_back_gain` é "chargeback vencido a favor do merchant" — o
dinheiro fica, então volta a valer como aprovada.

## Retry e timeout — isto DITA o desenho da rota

- **Timeout de 5 segundos.** Não respondeu 200 em 5s → entra em retry.
- Retentativas: +30min, +2h, +4h. Depois **descarta em definitivo, sem avisar**.
- Sucesso: qualquer 2xx (200–208, 226).

> *"Responda 200 antes de processar."*

É exatamente o padrão que a Fase 4 já usa no `/api/event`: responder primeiro,
trabalhar em `after()`. Aqui não é otimização, é requisito — enviar para a
Meta e o GA4 dentro da requisição estouraria os 5s numa rede ruim e geraria
retry de um evento que já foi processado.

## Idempotência

Não há id único de evento. A doc manda usar `event + order_id`
(`subscription_id + order_id + event` em assinaturas).

Atenção: um pedido de cartão gera `order_authorized` → `order_approved` →
`order_paid` → `order_integrated`, **todos com o mesmo `order_id`**. É uma
venda só, e tem de virar uma linha só e um envio só.

## Ordem não é garantida

> *"Atrasos de rede, retries e processamento assíncrono podem alterar a
> sequência."*

Então `order_refund` pode chegar antes de `order_approved`. O adaptador não
pode assumir sequência.

## Fluxos

```
Cartão: customer_created → order_authorized → order_approved → order_paid → order_integrated
Pix:    customer_created → order_pix_created → order_paid_by_pix → order_approved → order_integrated
                                             → [timeout] order_pix_expired
Boleto: customer_created → order_billet_created → order_paid → order_approved → order_integrated
                                                → [vencimento] order_billet_overdue
Estorno: order_refund (total) | order_partial_refund (parcial)
Chargeback: order_chargeback_in_treatment → order_charge_back_gain (ganhou)
```
