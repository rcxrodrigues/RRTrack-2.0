# Prompts para a extensão do Claude no navegador

Um por plataforma. A extensão lê a página **renderizada**, então alcança
conteúdo que o "Copy page" não traz — é assim que a doc da MillionsPay,
gerada de um `openapi.json` no cliente, deixa de ser um beco sem saída.

**A regra que vale para todos:** peça para ele dizer *"não documentado"* em
vez de deduzir. Um nome de campo inventado é pior que um buraco conhecido —
o buraco aparece no painel em vermelho; o campo errado falha calado.

---

## 1 · MillionsPay — a maior lacuna

`docs.millionspay.io` → API Reference → **Cobranças → Buscar cobrança**

```
Estou escrevendo um adaptador de webhook para esta API. Preciso do schema
COMPLETO do objeto de cobrança (charge), que nesta página aparece no
Response Body 200.

Extraia, exatamente como está na página:

1. Todos os campos do objeto `charge`: nome, tipo e descrição. Não resuma,
   não agrupe, não omita campo aninhado — quero a árvore inteira.
2. O campo de VALOR: nome, tipo, e se a doc diz em centavos ou em reais.
   Se ela não disser explicitamente, diga "não documentado" e me mostre o
   valor de exemplo que aparece na página, com o número literal.
3. O campo de STATUS: nome, e a enumeração completa de valores possíveis,
   se houver.
4. Os dados do cliente: nome, e-mail, telefone, documento, endereço — quais
   existem e como se chamam.
5. Qualquer campo livre que eu possa preencher ao criar a cobrança e receber
   de volta no webhook: `metadata`, `external_reference`, `custom_*`,
   `correlation_id`, `reference`. Diga o nome exato e o tipo.
6. O campo de data/hora da cobrança.

Responda em JSON, com o schema como você o leu. Se um campo aparecer na
página mas sem descrição, inclua o nome e marque a descrição como null.
NÃO complete com conhecimento de outras APIs de pagamento: só o que está
nesta página.
```

Depois, duas páginas curtas na mesma doc:

```
Nesta doc, vá em Guia → Webhooks → Eventos → Cobranças e me traga a LISTA
COMPLETA dos eventos `charge.*`, com o nome exato de cada um e o que
dispara cada um.

Em seguida procure a página sobre verificação de assinatura (busque por
"assinatura", "signature", "X-SoarLabz-Signature" ou "HMAC") e me diga
EXATAMENTE como o HMAC-SHA256 é calculado:

- sobre o corpo cru da requisição, ou sobre corpo + timestamp, ou outra
  combinação?
- o resultado é hexadecimal ou base64?
- há prefixo no header (tipo `sha256=`)?
- tem exemplo de código? Se sim, cole-o literalmente.

Se a doc não disser a fórmula, responda "não documentado" — não deduza pela
convenção do GitHub nem de outro serviço.
```

---

## 2 · Adoorei — a ponte da atribuição

`docs.adoorei.com`

```
Estou integrando o webhook de pedidos desta plataforma de checkout. Duas
perguntas, e a primeira é a que importa.

PRIMEIRA — parâmetro próprio atravessando o checkout:
Consigo mandar um parâmetro meu na URL do checkout (um identificador de
sessão de ~32 caracteres) e recebê-lo de volta no webhook do pedido?
Procure por: metadata, custom fields, campos customizados, parâmetros de
URL, tracking, UTM, referência externa, source_reference, external_id.

Se sim, me diga:
- o nome EXATO do parâmetro na URL, e o formato (ex.: `?metadata[chave]=`)
- em que campo do payload do webhook ele volta, com o caminho completo
- se funciona na URL do checkout, na URL da loja, ou nas duas
- limite de tamanho, se houver

Se não existir, diga "não existe" e liste todos os campos do payload que
aceitam texto arbitrário vindo da origem do pedido.

SEGUNDA — o header `X-Adoorei-hash`:
Procure o que a doc diz sobre esse header. Ele é um token fixo que eu
cadastro, ou um hash/HMAC calculado sobre o corpo? Se for hash, qual a
fórmula exata e qual o segredo usado? Se a doc não disser, responda "não
documentado".

Não deduza nenhuma das duas respostas: cite o trecho da doc, com a URL da
página onde achou.
```

---

## 3 · Zedy — confirmar a ponte

`app.zedy.com.br/docs`

```
Estou integrando o webhook de pedidos desta plataforma. Preciso confirmar
três coisas, citando o trecho da doc em cada uma.

1. Os campos `src` e `sck` (ou o objeto `trackingParameters`): eu consigo
   preenchê-los por parâmetro na URL do checkout e recebê-los de volta no
   webhook? Qual o nome exato do parâmetro na URL, e qual o caminho dele no
   payload do webhook? Há limite de tamanho?

2. A LISTA COMPLETA de eventos do webhook, com o nome exato de cada um
   (`eventType`), e quais deles significam pagamento aprovado, recusado,
   estornado e chargeback.

3. Autenticação e assinatura: a doc diz para eu conferir algum header? Se
   for HMAC, qual a fórmula exata? E confirme se o token vai em
   `Authorization: Bearer`.

Se algo não estiver documentado, diga "não documentado" em vez de deduzir.
```

---

## 4 · Yampi — nada bloqueia, mas se já estiver lá

`docs.yampi.com.br` (e o painel da loja, para o item 1)

```
Estou integrando o webhook de pedidos da Yampi. Quatro perguntas.

1. A LISTA COMPLETA de eventos de webhook, com o nome exato de cada um
   (ex.: `order.paid`, `transaction.payment.refused`). Quero todos, não só
   os de pedido — e me diga quais significam pagamento aprovado, recusado,
   estornado e chargeback. Marque quais são eventos FIXOS da Yampi e quais
   dependem de status configurado pela loja.

2. Assinatura: a Yampi assina o webhook? Qual header, e qual a fórmula
   exata (HMAC sobre o quê, hex ou base64, com qual segredo)? Se não
   assinar, diga que não assina.

3. O campo `value_total` do pedido INCLUI frete e descontos? Se a doc
   detalhar os campos de valor (`value_products`, `value_shipping`,
   `value_discount`, `value_total`), me traga todos com a descrição de
   cada um.

4. Estorno PARCIAL existe? Se sim, como o webhook informa — muda o
   `value_total`, ou traz um campo separado com o valor devolvido?

Cite o trecho da doc em cada resposta. Não deduza.
```

---

## 5 · Pagou — confirmar o eco

`developer.pagou.ai`

```
Estou integrando o webhook de transações desta API. Duas perguntas.

1. O campo `informations` (lista chave/valor da transação) é documentado
   como "echo on the webhook". Preciso CONFIRMAR: existe algum exemplo de
   payload de webhook na doc que mostre `informations` preenchido? Se sim,
   cole o exemplo inteiro, literalmente. Se todos os exemplos de webhook
   omitem o campo, diga isso explicitamente.

2. A doc menciona assinatura, HMAC ou algum header de verificação no
   webhook? Procure por "signature", "assinatura", "webhook secret",
   "HMAC". Se não houver nada, confirme que a autenticação é só pelo
   token na URL.

Cite a URL da página de cada resposta. Não deduza.
```

---

## 6 · Appmax — dois pontos cegos

`docs.appmax.com.br`

```
Estou integrando o webhook de pedidos desta API. Duas perguntas.

1. Existe alguma marca de PEDIDO DE TESTE no payload? Um campo booleano
   tipo `is_test`, `test`, `sandbox`, ou um ambiente separado? Preciso
   descartar pedidos de teste antes de mandá-los como conversão para a
   Meta. Se não existir, diga que não existe.

2. Estorno PARCIAL: a Appmax informa o valor devolvido, ou só que houve
   estorno? Se informar, em qual campo? E há evento distinto para estorno
   parcial e total?

Cite o trecho da doc. Não deduza.
```

---

## Depois de colar as respostas aqui

Nada disso trava a Fase 6. O que cada resposta destrava:

| resposta | destrava |
|---|---|
| `charge` da MillionsPay | o adaptador dela (hoje inexistente) |
| ponte da Adoorei | saber se a Adoorei serve como checkout |
| eventos e assinatura da Zedy | confirmar o adaptador dela |
| valores da Yampi | saber se o frete entra na receita |
| estorno parcial (qualquer uma) | hoje um estorno parcial desfaz a venda INTEIRA |
| marca de teste da Appmax | pedido de teste virando conversão |

O **estorno parcial** é o que eu mais quero saber de todas: hoje qualquer
estorno manda um `refund` do valor total ao GA4, e um estorno de R$ 20 numa
venda de R$ 200 subtrairia os R$ 200.
