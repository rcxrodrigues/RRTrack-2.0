# MillionsPay — o que se sabe (21/09/2026)

> **Estado: INCOMPLETO.** O que chegou foram 16 páginas do portal, todas no
> formato `<APIPage document="./openapi.json" operations="[…]" />` — um
> marcador que o site renderiza a partir do `openapi.json`. O conteúdo em si
> (campos, payloads, headers) **não veio**. Falta o arquivo.

## O que já dá para afirmar

### Assinatura HMAC-SHA256 — a única das três que assina

> *"Um secret HMAC-SHA256 é gerado automaticamente e retornado **apenas na
> criação**."* — `POST /v1/postbacks/endpoints`
>
> *"Gera um novo secret HMAC-SHA256 para o endpoint. O secret anterior é
> invalidado imediatamente."* — `POST /v1/postbacks/endpoints/{id}/secret/regenerate`

Isso muda o desenho: o token na URL vira o **piso**, não o teto. Onde há
assinatura, é ela que vale — o token na URL prova apenas que alguém conhece a
URL; a assinatura prova que o corpo não foi alterado no caminho.

**Consequência já implementada:** a rota lê o corpo como **texto cru**, não com
`request.json()`. HMAC assina os bytes exatos que chegaram, e reconstruir o
JSON com `JSON.stringify` muda espaçamento e ordem de chaves — a assinatura
nunca bateria. Ver `verificarAssinatura` em `src/lib/webhooks/tipos.ts`.

**Ainda falta, e sem isso não dá para verificar nada:**

- **Qual header** carrega a assinatura
- **O que exatamente é assinado** — o corpo cru? corpo + timestamp? há proteção
  contra replay?
- Codificação: hex ou base64?

### O recurso é `charge`, e tem autorização separada da captura

```
POST   /v1/charges                 cria (o body varia por método de pagamento)
GET    /v1/charges/{id}            busca
GET    /v1/charges                 lista, com paginação e filtros
POST   /v1/charges/{id}/capture    captura uma cobrança AUTORIZADA (parcial opcional)
POST   /v1/charges/{id}/refund     estorna uma capturada (parcial + motivo opcionais)
```

Autorizado **não é** dinheiro em caixa: só a captura conta como receita. E
existem **captura parcial** e **estorno parcial**, então o valor da linha muda
ao longo da vida da cobrança — o adaptador não pode assumir que o valor
inicial é o final.

### Os webhooks são gerenciados por API, não por campo no painel

```
POST   /v1/postbacks/endpoints                    cria (devolve o secret UMA vez)
GET    /v1/postbacks/endpoints                    lista
GET    /v1/postbacks/endpoints/{id}               busca
PATCH  /v1/postbacks/endpoints/{id}               atualiza url, eventos ou status
DELETE /v1/postbacks/endpoints/{id}               remove
POST   /v1/postbacks/endpoints/{id}/secret/regenerate   rotaciona o secret
```

### Log de entregas + reenvio — é por aqui que se testa de graça

```
GET  /v1/postbacks/delivery-logs           histórico, com paginação e filtros
POST /v1/postbacks/delivery-logs/{id}/resend   reenvia uma que falhou ou esgotou
```

Isso resolve o teste sem sandbox e sem gastar R$ 1:

1. Qualquer cobrança que já tenha passado por lá deixou o **payload real** no
   log de entregas. É só abrir e copiar.
2. Depois que o nosso endpoint estiver no ar, **reenviar** aquela mesma
   notificação para ele — teste de ponta a ponta com dado de produção.

### Irrelevante para nós

`/v1/banks`, `/v1/banks/code/{code}`, `/v1/banks/ispb/{ispb}` — consulta de
bancos, usada em transferência. Não toca venda.

## O que falta — e como conseguir de uma vez

Todas as 16 páginas são **geradas** do mesmo arquivo:

```
scripts/generate-openapi.ts  →  openapi.json  →  as páginas
```

**Pegar o `openapi.json`** resolve tudo de uma vez: campos, payloads, headers,
enumerações de status e de evento. É um arquivo só.

Se não houver como baixá-lo, o que falta é:

1. A página sobre **receber e validar** postbacks (não as de gerenciar
   endpoints) — payload de exemplo e o header da assinatura.
2. A **lista de eventos** que um endpoint pode assinar.
3. A **lista de status** de uma cobrança.
4. Se os valores vêm em **centavos** (as outras duas vêm).
5. Se há campo de **dados livres** na criação da cobrança que volte no webhook.
