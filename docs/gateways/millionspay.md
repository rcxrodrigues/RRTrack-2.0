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

### O que ainda falta, em ordem de importância

1. **O objeto `charge`** — sem ele não há como ler valor, status, cliente nem
   campo livre. É o que trava o adaptador inteiro.
2. **Centavos ou reais** — está no objeto `charge`. Errar dá 100× de
   diferença, em silêncio (a Yampi e a Adoorei mandam em reais; a Appmax, a
   Pagou e a Zedy em centavos — não há regra global).
3. **Campo livre que volte no webhook** (`metadata`, `external_reference`) —
   está no `POST /v1/charges`. É a ponte da atribuição: sem ela o
   `trck_user_id` não atravessa e só sobra o plano B por e-mail.
4. **A lista de eventos `charge.*`** — vimos `charge.captured` e
   `charge.refunded` de passagem.
5. **A fórmula exata do HMAC** — sobre o corpo cru? corpo + timestamp?

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
