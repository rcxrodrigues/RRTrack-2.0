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

## Os aliases de status — RESPONDIDA, e a resposta mudou o desenho

**Não existe lista fixa.** A página da API documenta só o *schema* do campo
(`data[].alias`, tipo `string`) porque **os status e seus aliases são
configuráveis por loja**. A da sua loja vem de:

```
GET /{alias}/checkout/statuses
→ cada status com id, order, alias, name, description
```

### Por que isso invalidou o adaptador

O mapa de aliases estava **cravado no código**, com `refunded` e `canceled`
chutados. Numa loja que renomeou o estorno para `devolvido`, aquele mapa
falharia — e falharia calado: o `refund` **nunca** chegaria ao GA4, e o
faturamento ficaria inflado por uma venda que voltou para o cliente.

É a mesma regra que o `CLAUDE.md` já registra para a Appmax, por outro
caminho: *decidir por um campo cuja enumeração ninguém conhece é escolher ser
surpreendido.* Lá a saída foi decidir pelo **evento**. Aqui o evento não
basta, porque `order.status.updated` só diz "mudou" — o alias é que diz para
quê.

### O desenho agora

1. **O evento ganha quando já responde.** `order.paid` e
   `transaction.payment.refused` são vocabulário da Yampi, não da loja, e não
   passam pelo alias. Se passassem, uma loja com status renomeado perderia a
   **venda paga** — o que mais importa.
2. **O alias vem do cadastro** (`settings.status_aliases`, painel →
   Configuração → Geral → Status do checkout), no formato `alias = status`.
3. **O mapa do código é só padrão de fábrica**, e o cadastro passa por cima.
4. **Alias que não está em lugar nenhum não vira venda nem desaparece:**
   volta como `Indeciso`, com o alias no motivo, e aparece **em vermelho** na
   tela de Eventos com a instrução do que cadastrar. Depois de cadastrar,
   **Reprocessar**.

O passo 4 é o que fecha o buraco: antes dele, alias desconhecido devolvia
`null` — indistinguível de "ignorei de propósito" — e a venda se escondia
atrás de um badge verde igual ao da nota fiscal.

## O que ainda falta

- [ ] **Os aliases da SUA loja** — `GET /{alias}/checkout/statuses`. Não é
      mais bloqueio: os de fábrica estão no código, e qualquer alias fora
      deles aparece em vermelho no painel dizendo o que cadastrar. Buscar a
      lista antes só antecipa o trabalho.
- [ ] **Se a Yampi assina o webhook** — os cabeçalhos de qualquer webhook
      real respondem sozinhos, na tela de eventos.
