# Os três checkouts, prontos para colar

Escolheu? Vá direto para a seção dele. Cada uma tem a linha exata, onde
cadastrar o webhook e o que mais aquele checkout exige.

O que **não** muda com a escolha: o snippet, as contas da Meta e do GA4, o
fuso, as origens permitidas. Tudo isso pode ser feito antes de decidir.

---

## O que de fato difere

| | Yampi | Zedy | Adoorei |
|---|---|---|---|
| ponte da atribuição | `metadata[trck_user_id]` — sólida, documentada | `src` / `sck` — sólida | `source_reference` — **frágil** |
| valores | reais (`199.90`) | centavos (`9700`) | reais (`110.00`) |
| marca pedido de teste | não | **sim** (`isTest`) | não |
| evento de estorno | **NÃO EXISTE** | sim | sim |
| exige cadastro extra | **sim** — status aliases | não | não |
| assina o corpo | sim (HMAC, doc contraditória) | não | não |

**A linha que mais pesa é a do estorno.** A Yampi não tem evento de
devolução — nem de chargeback. As duas listas autoritativas dela (14 eventos
na tabela, 13 no enum da API) não trazem nenhum. O único caminho documentado
para saber que uma venda voltou é `order.status.updated` mais o alias de
status da sua loja.

Consequência prática: **na Yampi o cadastro de aliases não é opcional.** Sem
ele o `refund` nunca chega ao GA4, e o faturamento fica inflado por uma venda
que já voltou para o cliente — calado, e para sempre.

Nas outras duas, um estorno chega como evento próprio e se resolve sozinho.

> A ponte da Adoorei é a mais fraca porque ela **não documenta saco de
> metadados**: sobra o `source_reference`, que é a referência do pedido na
> origem. Em compensação, o pedido dela traz o cliente completo — e-mail,
> telefone, nome separado —, então o plano B do casamento (por e-mail)
> funciona de verdade. Nas outras ele é rede de segurança; nela é parte do
> desenho.

---

## Yampi

**Configuração → Geral → domínios do checkout:**

```
SEU-DOMINIO-DE-CHECKOUT|metadata[trck_user_id]
```

O domínio é o que aparece na barra de endereço **na página de pagamento**,
não o da loja. Costuma ser algo como `seguro.sualoja.com.br`.

**Webhook:** cadastre a URL de Configuração → Geral no painel da Yampi, em
Configurações → Webhooks. Ela aceita `?token=` na própria URL.

**E o cadastro que não dá para pular:**

1. Chame `GET /{alias}/checkout/statuses` na API da Yampi (o `{alias}` é o da
   sua loja) — é a **única** forma de saber os status dela. Não existe lista
   fixa: os aliases são configuráveis por loja, o suporte confirmou em
   22/09/2026.
2. Cadastre cada um em Configuração → Geral → status aliases, mapeado para um
   dos cinco: `pendente`, `recusada`, `aprovada`, `estornada`, `chargeback`.

O adaptador já traz um padrão de fábrica — `waiting_payment`, `paid`,
`approved`, `refunded`, `canceled`, `cancelled` — mas ele é chute informado.
O cadastro vence, porque quem cadastrou olhou a própria loja.

> **O `cart_token` não serve de ponte, e o adaptador recusa de propósito.**
> Ele é hash, e hash tem hexadecimal de sobra para casar com a regex de 32.
> Aceitá-lo faria toda venda sem `metadata` nascer com um vínculo inventado:
> não casaria com visitante nenhum, e a linha ficaria com cara de atribuída
> sendo órfã.

---

## Zedy

**Configuração → Geral → domínios do checkout:**

```
SEU-DOMINIO-DE-CHECKOUT|src
```

Serve `sck` também — são dois campos genéricos, e o adaptador lê os dois. Use
`src` e guarde o `sck` para outra coisa.

**Webhook:** a Zedy documenta `Authorization: Bearer`. Cadastre a URL sem o
`?token=` e ponha o token no campo de cabeçalho, se o painel dela oferecer;
se não oferecer, a URL com `?token=` funciona igual — o endpoint aceita os
dois.

**Nada além disso.** É a mais direta das três: status por campo, valores em
centavos declarados (`priceInCents`), evento de estorno próprio, e ela ainda
marca pedido de teste com `isTest` — que o adaptador descarta antes de virar
conversão, para o otimizador da Meta não aprender a perseguir venda que não
existe.

> Ela manda dois valores: `totalPriceInCents` é o que o cliente pagou,
> `userCommissionInCents` é o que sobra depois da taxa. O adaptador usa o
> **bruto**. Usar o líquido faria o ROAS parecer menor do que é, e a campanha
> ser cortada à toa.

---

## Adoorei

**Configuração → Geral → domínios do checkout:**

```
SEU-DOMINIO-DE-CHECKOUT|source_reference
```

**Webhook:** ela manda o token no cabeçalho `X-Adoorei-hash` — e o nome
engana: apesar do "hash", é o token do cadastro comparado por igualdade, não
assinatura sobre o corpo. O endpoint já aceita esse cabeçalho.

**O que esperar:** a ponte pode não atravessar. O `source_reference` é a
referência do pedido na origem, e depende de a Shopify repassá-la. Se não
vier, o casamento cai para o e-mail — e aqui isso funciona bem, porque o
pedido da Adoorei traz o cliente completo.

Na tela de Eventos dá para ver qual dos dois pegou: abra a linha da venda e
olhe o motivo do casamento.

---

## Depois de escolher — o teste de trinta segundos

O que ninguém faz e é onde a atribuição morre:

1. Abra a loja com `?utm_source=teste`
2. Clique em comprar
3. **Olhe a barra de endereço do checkout.** O parâmetro está lá?

Se não estiver, a ponte não atravessou e toda venda vai chegar órfã. Mandar o
nome errado **não dá erro** — o checkout ignora, a venda entra normal, e você
só descobre semanas depois olhando um painel cheio de venda sem atribuição.

Se estiver, faça uma compra de verdade e siga o passo 7 do `PUBLICAR.md`.
