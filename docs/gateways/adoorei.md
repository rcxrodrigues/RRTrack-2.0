# Adoorei — checkout (doc lida inteira, 25/09/2026)

> Camada: **checkout**. Valores em **reais**. A doc tem **4 páginas**, todas
> marcadas "Versão Beta" e "Last updated 4 years ago".

## O que estava quebrando: o token

A Adoorei manda o token no header **`X-Adoorei-hash`**:

> "Toda requisição que for enviada pela Adoorei será feita com o header
> `X-Adoorei-hash`, com o **TOKEN informado na hora do cadastro** do webhook."

**O nome engana.** Apesar de "hash", não há fórmula, algoritmo, segredo nem
assinatura sobre o corpo em nenhuma das 4 páginas. É comparação de igualdade
com o token do cadastro.

A rota aceitava `?token=`, `Authorization: Bearer` e `x-webhook-token` — não
esse. **Toda venda da Adoorei tomaria 401 e se perderia.** Corrigido.

## A ponte da atribuição: não existe

Nenhuma das 4 páginas menciona `metadata`, campo customizado, parâmetro de
URL, UTM, tracking de origem ou `external_id`. A única ocorrência de
"tracking" no payload é **rastreio de entrega** (`resource.tracking.code`).

A doc não descreve nenhum campo: só exibe um payload de exemplo cru, sem
tabela, sem tipos, sem limites.

Os candidatos, todos leitura do exemplo e **nenhum documentado**:

| campo | no exemplo | leitura |
|---|---|---|
| `resource.source_reference` | `null` | o vizinho `resource.source` vale `"shopify\|woocommerce"` — então isto é provavelmente o **id do pedido na origem**, não valor nosso |
| `resource.items[].source_reference` | `40085810839652` | cara de variant id do Shopify |
| `resource.gateway_transaction_id` | `null` | preenchido pelo gateway |

> **O `checkout_token` do evento de carrinho é um hex de 32 — e por isso está
> FORA do adaptador.** Mesma armadilha do `cart_token` da Yampi: casaria com
> a regex e faria toda venda nascer com um vínculo inventado.

## O que isso significa na prática

A Adoorei é a **mais fraca** das três em atribuição. Sem saco de metadados, a
ponte depende de `source_reference` — que a doc não promete e o exemplo
sugere ser de outra coisa.

Em compensação, o pedido traz o cliente completo (`first_name`, `last_name`,
`doc`, `ip`, `email`, `phone`), então o **plano B por e-mail funciona** — e
ali ela é melhor que a Pagou por link de checkout, onde `informations` some.

**Para decidir:** se a atribuição por campanha importa (e importa — é o
produto), a Adoorei exige teste empírico antes de contratar. Anexe uma query
string ao `checkout_url` do carrinho, faça um pedido real, e olhe o payload
cru na tela de eventos. A doc não diz o que acontece com query string ali.

## O que falta

- [ ] **Teste empírico da query string** no `checkout_url`. É a única forma:
      a doc é beta e parada há quatro anos.
