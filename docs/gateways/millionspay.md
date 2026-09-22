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

## O que ainda falta

- [ ] **O objeto `charge`** — a doc mostra `{ "..." }`. Sem os campos não há
      como ler valor, status, cliente nem campo livre.
      Página: `/docs/guia/webhooks/eventos/cobrancas`
- [ ] **A lista de eventos `charge.*`** — só vimos `charge.captured` e
      `charge.refunded` citados de passagem. Mesma página.
- [ ] **A fórmula exata do HMAC** — sobre o corpo cru? corpo + timestamp?
      Procurar a página de verificação de assinatura.
- [ ] **Centavos ou reais** — está no objeto `charge`.
- [ ] **Campo livre** (`metadata`, `external_reference`) que volte no
      webhook. Está na criação da cobrança, `POST /v1/charges`.

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
