# MillionsPay — webhooks (doc oficial, recebida em 22/09/2026)

> Fonte: `docs.millionspay.io/docs/guia/webhooks/visao-geral`, colada pelo
> usuário. O domínio é inacessível do ambiente (`EGRESS_BLOCKED`).

## Envelope

O objeto de dados tem o **nome do prefixo do evento** — `charge.*` traz
`charge`, `withdrawal.*` traz `withdrawal`, e assim por diante.

```json
{
  "id": "uuid-do-delivery-log",
  "event": "charge.captured",
  "charge": { "..." },
  "occurred_at": "2026-02-24T10:00:00.000Z"
}
```

| campo | |
|---|---|
| `id` | id único da ENTREGA (delivery log) — a chave de deduplicação |
| `event` | `charge.*`, `submerchant.*`, `withdrawal.*`, `infraction.*` |
| `charge` / `withdrawal` / … | o objeto, nomeado pelo prefixo do evento |
| `occurred_at` | ISO 8601 |

Só `charge.*` interessa ao faturamento. `submerchant` é cadastro,
`withdrawal` é saque (dinheiro saindo) e `infraction` é MED — o Mecanismo
Especial de Devolução do Pix, o mesmo que a Pagou chama de `med`.

## Headers — e a assinatura

| header | |
|---|---|
| **`X-SoarLabz-Signature`** | **HMAC-SHA256 do payload**, no formato `sha256=abc123…` |
| `X-SoarLabz-Event` | o nome do evento, repetido |
| `X-SoarLabz-Delivery-Id` | o id da entrega, repetido |
| `User-Agent` | `SoarLabz-Postback/1.0` |

Cada endpoint tem **secret próprio**, o que permite apontar sistemas
diferentes com chaves diferentes.

> ⚠️ **O formato `sha256=<hex>` é a convenção do GitHub**, e nela o HMAC é
> calculado sobre o **corpo cru**, em hexadecimal. É a leitura
> esmagadoramente provável — mas a doc diz só "do payload", sem a fórmula.
>
> **Confirmar antes de ligar a verificação.** Se a fórmula for outra (corpo
> + timestamp, por exemplo), a verificação falharia em 100% dos webhooks e
> toda venda seria recusada com 401. É por isso que a rota já preserva o
> corpo cru: `request.text()` antes do `JSON.parse`.

## Retentativa

Backoff exponencial, documentado em `/docs/guia/webhooks/retentativas`.
Resposta esperada: **2xx**.

## O atalho: a doc inteira é gerada de um `openapi.json`

Toda página da API Reference é só um invólucro. O MDX que o "Copy page"
devolve é sempre isto, e nada mais:

```
{/* AUTO-GENERATED from openapi.json by scripts/generate-openapi.ts. */}
<APIPage document="./openapi.json" operations="[{"path":"/v1/…","method":"post"}]" />
```

O conteúdo — campos, tipos, exemplos de resposta — é montado **no navegador**,
a partir de um arquivo só. É por isso que colar a página não traz nada: o
texto não está nela.

> **Então o pedido é um arquivo, não uma sequência de páginas.**
> Esse `openapi.json` tem TODOS os endpoints, TODOS os campos e o schema
> completo do objeto `charge`. Ele responde de uma vez tudo que falta aqui.
>
> Como achar: abra a API Reference, **F12 → aba Network → recarregue → filtre
> por `openapi`**. O arquivo aparece na lista; clicar com o botão direito dá
> "Copy → Copy response". (Tentei baixar daqui: o domínio é bloqueado pelo
> proxy de saída, como o dos outros gateways.)

Sem ele, o caminho longo é uma página só: **`GET /v1/charges/{id}`
("Buscar cobrança")**, cujo *Response Body* 200 é o objeto `charge` inteiro —
o mesmo que vem dentro do webhook. Só que ela também é `<APIPage>`, então
teria de ser **captura de tela**, não texto colado.

## O que a extensão confirmou (25/09/2026)

### Valor: CENTAVOS, e documentado com todas as letras

| campo | |
|---|---|
| `amount` | number, **em centavos** — "ex: R$ 100,00 = 10000" |
| `shipping_amount` | centavos |
| `total_amount` | centavos |

Sem ambiguidade, ao contrário da Yampi e da Adoorei. Entra em `deCentavos()`.

### Campo livre: **só** `metadata`

`metadata: object | null`. E o que **não** existe, verificado página a
página: `external_reference`, `correlation_id`, `custom_*`, `reference`.
Existe um `external_id`, mas é **da adquirente**, não nosso.

Então a ponte da atribuição da MillionsPay é `metadata`, e só.

### Datas

`created_at`, `updated_at`, `captured_at`, `refunded_at` no charge;
`occurred_at` no envelope.

### O cliente NÃO volta completo no webhook

No objeto `charge` do webhook existe só `customer: object | null`. Nome,
e-mail, telefone e `tax_id` aparecem no **Request Body de `createCharge`**,
não no charge que chega. Endereço (`billing_address` / `shipping_address`)
não volta de jeito nenhum — só existe na criação.

**Consequência para o plano B:** se o `customer` do webhook vier vazio ou
parcial, o casamento por e-mail não roda, e a ponte por `metadata` vira a
única. Confirmar no primeiro postback real.

### O HMAC: a doc se contradiz

O que está resolvido: header `X-SoarLabz-Signature`, HMAC-SHA256,
hexadecimal, prefixo `sha256=`, sem timestamp.

O que **não** está: o texto diz "corpo da requisição" (cru), e o exemplo em
Node assina `JSON.stringify(req.body)` — que é **reserialização**, não o
corpo cru. `JSON.stringify` de um objeto já parseado muda espaçamento e
ordem de chaves; o hash não é o mesmo.

Não dá para deduzir: é contradição da própria doc, e se resolve no primeiro
postback real comparando os dois. É exatamente por isso que a rota preserva o
corpo cru — a verificação pode ser acrescentada depois sem mexer em mais nada.

## O que ainda falta para escrever o adaptador

1. **Os 8 valores do enum de `status`** — confirmados como existindo em dois
   lugares da doc, mas a lista não foi copiada.
2. **Os 9 nomes dos eventos `charge.*`** — idem: contados, não listados.
3. **Os 20 nomes de campo da raiz do `charge`** — idem.

Sem esses três, o adaptador não sai: não há como mapear status nem decidir
por evento. São três listas curtas, e o resto já está aqui.

Depois delas, o buraco que sobra é `payment_details` de **PIX e boleto** (só
o exemplo de cartão foi aberto) — e esse é o que mais provavelmente pega
depois, porque muda por método de pagamento.

## Endpoints de gerenciamento (já conhecidos)

```
POST   /v1/postbacks/endpoints                          cria (devolve o secret UMA vez)
GET    /v1/postbacks/endpoints                          lista
GET    /v1/postbacks/endpoints/{id}                     busca
PATCH  /v1/postbacks/endpoints/{id}                     atualiza url, eventos ou status
DELETE /v1/postbacks/endpoints/{id}                     remove
POST   /v1/postbacks/endpoints/{id}/secret/regenerate   rotaciona o secret
GET    /v1/postbacks/delivery-logs                      histórico, com o payload real
POST   /v1/postbacks/delivery-logs/{id}/resend          reenvia uma entrega
```

O par **delivery-logs + resend** é como testar sem sandbox: qualquer cobrança
que já passou por lá deixou o payload guardado, e dá para reenviá-la ao
nosso endpoint depois que ele estiver no ar.

## Cobranças (do que já se sabia)

```
POST   /v1/charges                 cria (o body varia por método de pagamento)
GET    /v1/charges/{id}            busca
GET    /v1/charges                 lista
POST   /v1/charges/{id}/capture    captura uma AUTORIZADA (parcial opcional)
POST   /v1/charges/{id}/refund     estorna uma capturada (parcial + motivo)
```

Autorizado **não é** dinheiro em caixa: só a captura conta — e daí o evento
se chamar `charge.captured`, não `charge.paid`. Há captura e estorno
**parciais**, então o valor da cobrança muda ao longo da vida dela.

## O mapa da API (do vídeo de 21/09/2026)

`Server URL: https://api.millionspay.io`. A doc se divide em **Guia** e
**API Reference**; o que segue é o índice da segunda, inteiro.

| grupo | endpoints |
|---|---|
| **Bancos** | buscar por código, buscar por ISPB, listar |
| **Cobranças** | criar, buscar, listar, **capturar**, **estornar** |
| **Checkout** | listar métodos de pagamento do merchant |
| **Links de Pagamento** | criar, buscar, listar, atualizar, desativar, upload/remoção de capa e logo |
| **Carteiras** | buscar, listar, extrato, lançamentos |
| **Recebíveis** | buscar, listar, resumo |
| **Antecipações** | simular, solicitar, buscar, listar, cancelar, resumo |
| **Submerchants** | cadastro completo — endereços, documentos, representantes legais, análise |
| **Saques** | criar, buscar, listar, taxa, métodos habilitados, comprovante, resumo |
| **Recebedores** | buscar por tipo, listar, criar ou atualizar |
| **Webhooks** | criar/buscar/listar/atualizar/remover endpoint, **regenerar secret**, **listar logs de entrega**, **reenviar notificação** |

O índice confirma o que já estava escrito acima: captura e estorno são
endpoints separados da criação, e o secret do webhook é por endpoint e
rotacionável — com reenvio de entrega, que é como se testa sem sandbox.
