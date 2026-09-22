# Yampi — checkout (respostas do suporte, 22/09/2026)

> Camada: **checkout**. É ela quem manda o webhook de venda num funil
> Shopify → Yampi → gateway. Valores em **reais**.

## A ponte da atribuição — RESPONDIDA

**Funciona, mas só por `metadata`, e só na URL do checkout.**

```
https://seguro.minhaloja.com/checkout?metadata[trck_user_id]=abc123
                                       ^^^^^^^^^^^^^^^^^^^^^
```

Volta no webhook em `resource.metadata.data[]`, como lista de `{key, value}`:

```json
"metadata": {
  "data": [
    { "key": "trck_user_id", "value": "abc123" },
    { "key": "cart_id",      "value": "123456" }
  ]
}
```

O que o suporte descartou, com todas as letras:

| tentativa | resposta |
|---|---|
| nome livre (`?trck_user_id=…`) | **não** — só dentro de `metadata[...]` |
| na URL da loja/vitrine | **não** — só na URL do checkout |
| `cart_token` | é só o identificador do carrinho |
| campo "tracking" dedicado | não existe |
| as 5 UTMs da Yampi | são da **vitrine**, não do checkout |

### O que isso obrigou a mudar aqui

**O snippet escrevia `?trck_user_id=…`** — nome que a Yampi ignora. A ponte
teria falhado em silêncio: o link vai, a compra acontece, o webhook chega sem
o vínculo, a venda entra no faturamento e **some do ROAS por campanha**, que
é o produto.

Agora o nome do parâmetro é **configuração por domínio**, ao lado do próprio
domínio (`settings.checkout_domains`):

```
seguro.minhaloja.com|metadata[trck_user_id]
pay.outrocheckout.com|src
loja.terceira.com                      ← sem o `|`, vale trck_user_id
```

Cravar o nome no código repetiria, numa porta nova, o erro que o `CLAUDE.md`
já registra: regex fixa de plataforma dentro do snippet.

**O colchete vai literal, não escapado.** O `URLSearchParams` produziria
`metadata%5Btrck_user_id%5D`; a doc da Yampi mostra a forma literal e é ela
que devolvemos — em vez de apostar que o servidor deles decodifica antes de
montar o array. A troca é só da **chave** escapada seguida de `=`, nunca do
href inteiro: desescapar tudo mexeria no valor de outro parâmetro.

`src/lib/snippet-marcacao.test.ts` **executa** o snippet contra estes casos.

### E o `cart_token` saiu do adaptador

Ele é um hash, e hash tem hexadecimal de sobra para casar com a regex de 32.
Aceitá-lo faria **toda** venda sem `metadata` nascer com um vínculo
inventado: não casaria com visitante nenhum, e a linha ficaria com cara de
atribuída sendo órfã.

O saco `metadata` também volta inteiro, com o `cart_id` e o que mais houver:
o valor só vale se a **chave** for nossa.

## O risco que sobra, e só a loja real responde

O parâmetro tem de estar **na URL do checkout**. O snippet marca links
`<a href>` cujo host bate com o cadastro — mas num funil Shopify o botão de
compra às vezes é **redirecionamento por JavaScript**, montado pelo script da
própria plataforma. Aí não existe âncora para marcar, e a ponte não acontece.

**Como conferir, em trinta segundos, quando a loja estiver de pé:** abra a LP,
clique em comprar e olhe a barra de endereços do checkout. Se
`metadata[trck_user_id]=` estiver lá, está resolvido. Se não estiver, o
caminho é pedir à Yampi/Shopify que o parâmetro atravesse o redirecionamento.

## O que ainda falta

- [ ] **A tabela de aliases de status** — `GET {alias}/checkout/statuses`
      devolve `id, order, alias, name, description`. Preciso da coluna
      **`alias`**.

      **Venda paga está coberta**: `order.paid` é evento documentado e ganha
      do alias. O risco é o **estorno** — se ele vier como mudança de status
      e o alias não for `refunded` nem `canceled`, que foi o que chutamos, o
      GA4 nunca recebe o `refund` e o faturamento fica inflado por uma venda
      que voltou.
- [ ] **Se a Yampi assina o webhook** — os cabeçalhos de qualquer webhook
      real respondem sozinhos, na tela de eventos.
