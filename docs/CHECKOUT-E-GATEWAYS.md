# Checkout e gateways — o que testar antes de fechar contrato

> Anotado em 21/09/2026, para ser executado quando o sistema estiver pronto.
> Nada aqui é código: é a decisão de infraestrutura que define se a atribuição
> vai ser exata ou torta.

## O contexto

A primeira loja (transforlar.com) é **Shopify com checkout de terceiro**, e os
gateways cogitados são **AppMax**, **Pagou.ai** e **MillionsPay**. O checkout
fica numa plataforma separada, que usa o gateway só como processador.

## A pergunta que decide tudo

Não é "tem webhook?" — praticamente todo checkout tem, e isso não desempata.
É esta:

> O checkout aceita um parâmetro qualquer na URL, guarda, e **devolve no
> webhook**?

```
https://seguro.sualoja.com/xyz?trck_user_id=a1b2c3...
                                └── ele guarda? e manda de volta? ──┘
```

Ter webhook garante saber que vendeu. Sem o parâmetro voltando, sabe-se que
vendeu — mas não de qual anúncio.

## Por que isso pesa mais aqui do que num infoproduto

No infoproduto a pessoa costuma deixar e-mail antes (isca, grupo, lista), e
casar a venda pelo e-mail funciona bem.

**Numa loja, quem olha produto não deixa e-mail nenhum.** A primeira vez que o
sistema veria o e-mail é no próprio webhook da venda — e aí não há nada
anterior com que casar. O plano B (e-mail → telefone) vai pegar pouca coisa
nesse funil.

Traduzindo: o parâmetro na URL não é refinamento, é a ponte principal.

## O teste — 5 minutos, sem depender de documentação

1. Abrir **webhook.site** e copiar a URL que ele dá.
2. Colar essa URL no campo de webhook do checkout.
3. Montar um link de checkout com `?trck_user_id=TESTE12345` no fim.
4. Fazer uma compra de teste (sandbox ou R$ 1).
5. No webhook.site, `Ctrl+F` por **TESTE12345**.

**Achou** → o checkout serve, atribuição exata.
**Não achou** → procurar na doc por `metadata`, `custom_fields`,
`external_reference` ou `custom_id` na criação do pedido. Se existir algum, dá
para usar no lugar.

## Ordem de importância ao comparar plataformas

| | o que checar | por quê |
|---|---|---|
| 1º | parâmetro da URL volta no webhook | atribuição exata, sem depender de mais nada |
| 2º | permite colar script próprio na página | o snippet roda lá, lê o id da URL e fecha o vínculo pelo e-mail digitado |
| 3º | webhook manda e-mail e telefone | só serve se já conhecêssemos a pessoa |
| — | ter webhook | todos têm, não desempata |

Com 1º **ou** 2º está resolvido. Os dois juntos é o ideal.

## Depois de escolher

Cadastrar o domínio em **Configuração → Geral → Domínios do checkout**. É o que
faz o snippet pendurar o `trck_user_id` nos links. Sem isso, nenhum link é
marcado — ver `src/lib/snippet.ts`.

## Como rodar o teste, na prática

### Antes: uma conta em pelo menos um gateway

Os três têm cadastro gratuito. **Um só já basta** para destravar a Fase 5 — o
adaptador dele sai junto com a interface comum, e os outros dois entram depois
com poucas linhas cada. Melhor um funcionando de verdade que três adivinhados.

### 1. Criar a URL que escuta (2 minutos, sem cadastro)

Abrir **webhook.site**. Ele já mostra uma URL única no topo, tipo
`https://webhook.site/8f3a...`. Copiar. **Deixar a aba aberta** — é nela que a
entrega vai aparecer, ao vivo.

### 2. Cadastrar a URL no gateway (ou no checkout)

Procurar no painel dele por: *Webhooks*, *Notificações*, *Postback*,
*Integrações* ou *Callbacks*. Colar a URL.

Se pedir para escolher eventos, marcar **todos** — o excesso não atrapalha, e
é assim que se descobre o que ele manda de verdade.

> Vale para quem manda o webhook, seja o gateway ou a plataforma de checkout.
> O procedimento é o mesmo.

### 3. Montar o link de checkout COM o parâmetro

Antes de comprar, acrescentar ao fim do link:

```
?trck_user_id=TESTE12345
```

Se o link já tiver `?`, usar `&` no lugar. É este valor que vamos procurar
depois.

### 4. Fazer a venda de teste

Em ordem de preferência:

| como | custo | observação |
|---|---|---|
| **Sandbox / modo teste** | zero | cartão fake que o próprio gateway fornece. O melhor, quando existe |
| **PIX de R$ 1** | R$ 1 | você paga para você mesmo; cai na hora |
| **Cartão de R$ 1** | R$ 1 | estornar depois — e o estorno serve ao passo 6 |

### 5. Ler o que chegou

No webhook.site, a entrega aparece sozinha na lista à esquerda. Abrir e ir na
aba **Raw content** — é o JSON cru, que é o que interessa.

Primeira coisa: **Ctrl+F por `TESTE12345`**.

- **Achou** → o checkout repassa o parâmetro. Atribuição exata. É o melhor caso.
- **Não achou** → cai para o plano B (e-mail). Ainda funciona, casa menos.

Copiar o Raw content inteiro.

### 6. O passo que todo mundo pula: testar o ESTORNO

Estornar a venda de teste e ver se chega um **segundo** webhook, e com qual
status.

Sem tratar estorno, a venda cancelada continua contando como receita e o ROAS
mente para cima — que é exatamente o problema que este sistema existe para
resolver. Copiar esse segundo JSON também.

---

## O que enviar, de cada gateway

Em ordem de importância. O item 1 sozinho já resolve a maior parte.

### 1. O JSON de uma venda aprovada
Página: *Webhooks*, *Postback* ou *Notificações* — ou, melhor, o payload real
do teste acima.
→ É de onde sai todo nome de campo. Sem isso não há adaptador.

### 2. Como validar que o POST veio mesmo dele
Mesma página, ou *Segurança* / *Autenticação*. Qual dos três:

- **Assinatura**: qual header, qual algoritmo (HMAC-SHA256?), e sobre **o quê**
  — corpo cru? corpo + timestamp?
- **Token fixo** em header ou na URL
- **Faixa de IP**

→ Sem isso, quem descobrir a URL insere venda falsa no faturamento.

### 3. Os status, escritos exatamente como ele manda
Os cinco: aprovado, pendente, recusado, estornado, chargeback.
→ Decide o que vira receita e o que **desfaz** receita.

### 4. O valor vem em centavos ou em reais?
`19750` ou `197.50`? Erro de 100× que **não dá erro nenhum** — só um ROAS
absurdo que demora semanas para levantar suspeita. Junto: é bruto? inclui
frete? já desconta cupom?

### 5. O campo de dados livres na criação do pedido
`metadata`, `custom_fields`, `external_reference` ou `custom_id` — e se ele
**volta no webhook**. É a ponte da atribuição.

### 6. Quantos webhooks, e se ele reenvia
Uma URL por tipo de evento, ou uma URL só com um campo `event`? Reenvia em
caso de erro? Quantas vezes?

---

## Pendências para a Fase 5

Ainda não dá para escrever os adaptadores de webhook. Falta:

- [ ] **Nome da plataforma de checkout** escolhida (pode ser ela quem manda o
      webhook, não o gateway).
- [ ] **Resultado do teste do `TESTE12345`** (ver o passo a passo acima).
- [ ] **Documentação dos três gateways**, colada aqui ou em arquivo. As três
      URLs estão bloqueadas pela política de saída de rede do ambiente de
      desenvolvimento — `docs.appmax.com.br`, `developer.pagou.ai` e
      `www.sejamillionspay.com` respondem `EGRESS_BLOCKED`. Não adianta tentar
      de novo; o conteúdo precisa ser colado.

De cada gateway, o que importa:

1. O JSON de uma venda aprovada no webhook.
2. Como validar que o POST veio mesmo dele (assinatura HMAC? token em header?
   faixa de IP?).
3. Os status exatamente como ele escreve (aprovado, pendente, recusado,
   estornado, chargeback).

### Pistas achadas (não-oficiais — conferir contra a doc real)

Busca pública encontrou duas integrações de AppMax em código aberto. Servem
para adivinhar o formato, **não** para confiar:

- `github.com/ecomplus/app-appmax` — integração de produção da E-Com Plus
- `github.com/joaotonaco/appmax-api-sdk` — SDK não-oficial em Node

O portal oficial é `appmax.com.br/developers/`, e há uma coleção no Postman
(`postman.com/ecoproapi/appmax`).
