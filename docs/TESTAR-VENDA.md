# Testar a venda inteira — antes de ter checkout

O RRTrack tem duas metades. A de cima (visitante, PageView, carrinho,
checkout) você já viu funcionando na loja. A de baixo — **webhook → grava →
casa com o visitante → manda para a Meta** — nunca rodou, porque depende de
um checkout que ainda não está ligado.

Este documento faz ela rodar **hoje**, com um pedido de mentira. A ideia não
é ver um número bonito no painel: é descobrir agora, com calma, o que você
descobriria durante a primeira venda de verdade — que é a pior hora possível.

---

## Antes: os dois números que você precisa

**1. O token do webhook.** Configuração → Geral. Ele aparece mascarado; se
você não tiver guardado, gere um novo ali e copie.

**2. Um `trck_user_id` de verdade, seu.** Eventos → clique em qualquer linha
→ o identificador está no topo da gaveta. Pode ser de uma visita sua.

> **Por que um id REAL, e não um inventado:** é ele que faz o casamento
> acontecer. Com um id inventado a venda entra órfã, o teste "passa", e você
> não terá exercitado justamente a ponte que quebra na vida real.

Nos comandos abaixo, troque `SEU_TOKEN` e `SEU_TRCK_USER_ID`.

---

## Passo 1 — o teste seguro (não manda nada para a Meta)

O status vai como **pendente** de propósito. Só `aprovada` dispara conversão,
então este passo exercita webhook, adaptador, gravação e casamento **sem
encostar no seu pixel**.

Escolha o gateway que você vai usar. Os payloads abaixo são os exemplos da
documentação de cada um, com o `trck_user_id` no lugar certo.

### Appmax

```bash
curl -X POST "https://track.transforlar.com/api/webhook/compra?token=SEU_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "event": "order_authorized",
    "event_type": "order",
    "client_key": "SEU_TRCK_USER_ID",
    "data": {
      "order_id": 999001,
      "status": "aguardando_pagamento",
      "total": 25990,
      "customer": { "email": "teste@exemplo.com", "firstname": "Teste" },
      "products": [{ "sku": "TESTE-1", "name": "Produto de teste", "price": 25990, "quantity": 1 }],
      "client_key": "SEU_TRCK_USER_ID"
    }
  }'
```

### Yampi

O `trck_user_id` da Yampi volta **só** por `metadata`, e é assim que ele
chega:

```bash
curl -X POST "https://track.transforlar.com/api/webhook/compra?token=SEU_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "event": "order.created",
    "time": "2026-09-27T10:00:00Z",
    "merchant": { "alias": "minha-loja" },
    "resource": {
      "id": 999002,
      "value_total": 199.90,
      "status": { "data": { "alias": "waiting_payment" } },
      "customer": { "data": { "email": "teste@exemplo.com", "name": "Teste" } },
      "metadata": { "data": [{ "key": "trck_user_id", "value": "SEU_TRCK_USER_ID" }] }
    }
  }'
```

> **Yampi: o `alias` acima é o padrão de fábrica, não o da SUA loja.** Os
> aliases da Yampi são configuráveis por loja — a sua pode chamar o mesmo
> estado de `aguardando_pagamento`. Se o teste voltar com badge **vermelho**
> dizendo "alias não está mapeado", não é defeito: é o sistema pedindo o
> cadastro em Configuração → Geral → Status do checkout. Descubra os seus em
> `GET /{alias}/checkout/statuses`. Esse cadastro é **obrigatório** para quem
> usa Yampi, porque ela não tem evento de estorno: sem o alias certo, uma
> venda devolvida nunca vira `refund` e o faturamento fica inflado.

### Zedy

O `orderId` vai como **texto**, entre aspas — é o token do checkout, não um
número, e a própria doc da Zedy manda usá-lo para deduplicar.

```bash
curl -X POST "https://track.transforlar.com/api/webhook/compra" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -d '{
    "eventType": "ORDER_CREATED",
    "orderId": "Z-999003",
    "status": "waiting_payment",
    "customer": { "name": "Teste", "email": "teste@exemplo.com", "country": "BR" },
    "products": [{ "id": 1, "name": "Produto de teste", "quantity": 1, "priceInCents": 9700 }],
    "commission": { "totalPriceInCents": 9700 },
    "trackingParameters": { "src": "SEU_TRCK_USER_ID", "utm_source": "teste" },
    "isTest": false
  }'
```

### Adoorei

```bash
curl -X POST "https://track.transforlar.com/api/webhook/compra" \
  -H 'Content-Type: application/json' \
  -H 'X-Adoorei-hash: SEU_TOKEN' \
  -d '{
    "event": "order.created",
    "time": "2026-09-27T10:00:00Z",
    "merchant": { "id": 1 },
    "resource": {
      "number": 999004,
      "status": "pending",
      "value_total": 110.00,
      "source_reference": "SEU_TRCK_USER_ID",
      "customer": { "email": "teste@exemplo.com", "nome": "Teste" }
    }
  }'
```

### Pagou

```bash
curl -X POST "https://track.transforlar.com/api/webhook/compra?token=SEU_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "evt-teste",
    "event": "transaction",
    "data": {
      "id": "999005",
      "status": "pending",
      "amount": 25990,
      "payer": { "email": "teste@exemplo.com", "name": "Teste" },
      "informations": [{ "key": "trck_user_id", "value": "SEU_TRCK_USER_ID" }]
    }
  }'
```

> **Estes cinco payloads são testados a cada `npm run check`.**
> `src/lib/webhooks/exemplos-do-doc.test.ts` passa cada um pelos adaptadores
> de verdade e prova três coisas: que o adaptador certo reconhece, que o
> `trck_user_id` atravessa, e que o status entra como `pendente` — a trava
> que impede o Passo 1 de mandar conversão. Se algum adaptador mudar e o
> exemplo parar de valer, quebra o teste, não o seu dia.

---

## O que conferir, nesta ordem

**1. A resposta do curl.** Ela já diz muita coisa:

| resposta | o que significa |
|---|---|
| `200` | chegou e foi tratado |
| `401` | token errado — e é aqui que a maioria para |
| `202` | nenhum adaptador reconheceu o formato |
| `500` | falha nossa ao gravar. Me manda o erro |

**2. Eventos → Webhooks recebidos.** A linha tem de aparecer, com badge
**verde** e o nome do adaptador. Amarelo é "ninguém reconheceu"; vermelho é
"reconheci e não soube ler", e a mensagem diz exatamente o que cadastrar.

**3. Faturamento.** A venda aparece como `pendente`. Ela **não** entra na
receita — receita é sobre `aprovada`.

**4. Eventos → abra o visitante daquele `trck_user_id` → seção Compra.**
É o teste que importa. Tem de dizer:

> Casou: **pelo identificador — a ponte funcionou**

Se disser **NÃO casou**, o `trck_user_id` não chegou no campo certo do
payload. Confira que você colou no lugar indicado para o seu gateway — cada
um usa um, e mandar no campo errado não dá erro nenhum.

---

## Passo 2 — o teste completo (opcional, e com duas travas)

Só faça este se quiser ver a conversão chegando na Meta. Ele **manda um
Purchase de verdade**, então:

### Antes, ligue o Test Events

Configuração → Meta → o campo `test_event_code` do seu pixel. O código sai do
Events Manager → seu pixel → **Testar eventos**. Com ele preenchido, a
conversão vai para a aba de teste e **não conta** para o otimizador.

> ⚠️ **Apague o `test_event_code` quando terminar.** Esquecido preenchido em
> produção, ele manda TODA conversão para Test Events, onde ela não conta: a
> Meta para de aprender e a campanha morre sem ninguém entender por quê. É a
> falha mais cara que este projeto tem, e é silenciosa.

### Depois, repita o curl com o status aprovado

Mesmo payload, trocando o evento/status pelo de aprovação — na Appmax,
`"event": "order_approved"` e `"status": "aprovado"`; na Yampi,
`"event": "order.paid"`; na Zedy, `"eventType": "ORDER_PAID"` e
`"status": "paid"`.

**Use o MESMO `order_id`.** A linha é uma por pedido, então o status avança
na venda que já existe, exatamente como aconteceria de verdade.

### Confira

Na gaveta do visitante, a seção Compra passa a dizer **Foi para a Meta** com
a hora. Se disser *"ainda não — veja o log do evento"*, algo falhou no envio
e o motivo está gravado.

No Events Manager, a aba **Testar eventos** mostra o `Purchase` chegando.

---

## Limpar depois

A venda de teste fica no faturamento. Para tirar, no SQL Editor do Supabase:

```sql
-- Confira ANTES de apagar. Os ids de teste começam em 999.
select transaction_id, status, value, sent_at
from public.purchases
where transaction_id like '%:99900%';

-- E só então:
delete from public.purchases where transaction_id like '%:99900%';
```

O payload cru fica em `webhooks_recebidos` e não atrapalha nada — ele some
sozinho em 30 dias, e até lá serve de referência do formato.

> **A conversão que já foi para a Meta não volta.** A Conversions API não tem
> "anti-Purchase" — é por isso que o Passo 2 pede o `test_event_code` antes,
> e não depois.
