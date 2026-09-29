# Auditoria da lógica de tracking — 29/09/2026

Diagnóstico antes de publicar.

> ## ✅ O que já foi CORRIGIDO depois deste diagnóstico
>
> | # | achado | estado |
> |---|---|---|
> | 1 | Purchase com 7 parâmetros contra os 11 do PageView | **corrigido** — `external_id`, `ct`, `st`, `country` |
> | 2 | `hashCep` órfã, `zp` nunca enviado | **corrigido** — coluna `zip`, extração na Adoorei, `ATUALIZAR-D` |
> | 3 | `event_time` com `Date.now()` | **corrigido** — e melhor que o proposto: sai de `occurred_at` (a hora do GATEWAY), não de `created_at` |
> | 4 | Advanced Matching do Pixel desligado | **corrigido** — `identify` alimenta o `fbq` |
> | 5 | `external_id` fora do Pixel | **deliberadamente NÃO feito** — ver abaixo |
> | 6 | `gclid` | não feito — só importa com Google Ads |
>
> **Um achado a mais apareceu durante a correção**, do mesmo tipo do CEP: os
> **cinco** adaptadores já extraíam `ocorridoEm` — a hora em que o gateway
> diz que o pagamento saiu — e o valor morria no caminho, porque não havia
> coluna. É melhor que o `created_at` que este relatório propunha, e virou a
> fonte do `event_time` da Meta e do `timestamp_micros` do GA4.
>
> **O item 5 continua aberto, e é decisão de dado, não de código:** o
> servidor manda `external_id` hasheado; não consegui confirmar se o
> `fbevents.js` hasheia esse campo ou o trata como id opaco. Divergir é pior
> que faltar, então fica fora, com teste travando a ausência. Resolve-se
> olhando o Events Manager depois dos primeiros eventos reais.
>
> Para rodar: **`supabase/atualizacoes/ATUALIZAR-2026-09-29-D-COMPACTO.sql`**.

---

## Como verifiquei, e o que NÃO consegui verificar

Preciso ser exato sobre isto, porque muda o peso de cada item abaixo.

| fonte | alcancei? | o que usei |
|---|---|---|
| `developers.facebook.com` | ❌ **não** | bloqueado por política de egress deste ambiente (403 no CONNECT) |
| `developers.google.com` | ❌ **não** | idem |
| **SDK oficial da Meta** | ✅ **sim** | `facebook_business 26.0.2` baixado do PyPI |
| Busca na web | ⚠️ parcial | só blogs de terceiros — **não** usei como autoridade |

O SDK vale **mais** que a página de parâmetros para esta pergunta, e o
CLAUDE.md já dizia isso: a página diz *"sem pontuação, sem caracteres
especiais"* e o `normalize.py` faz outra coisa — é a implementação de
referência que a Meta roda, e é ela que decide se o hash bate.

E o major do SDK acompanha a Graph API: **26.0.2 ↔ v26.0**, exatamente a
versão que o projeto fixou. Li `normalize.py` e `user_data.py` inteiros.

> ⚠️ **O lado do GA4 não foi verificado contra doc viva.** Os itens de GA4
> abaixo saem da leitura do código e do meu conhecimento, que tem data de
> corte. Trate-os como "provável", não como "conferido".

Uma correção que a leitura do SDK já rende: vários guias dizem que o
telefone vai em **E.164 com `+`** (`+5511999998888`). O `normalize.py` faz
`re.sub(r"^\+?0{0,2}", "", …)` — **tira o `+`**. O projeto já estava certo,
e quem seguir os blogs erra.

---

## 1. Evento por evento

| evento | navegador (Pixel) | servidor (CAPI) | dedup | status |
|---|---|---|---|---|
| **PageView** | ✅ via `api.track` | ✅ | ✅ mesmo `event_id` | **ok** |
| **ViewContent** | ✅ só em `/products/…` | ✅ | ✅ | **ok** |
| **AddToCart** | ✅ | ✅ | ✅ | **ok** |
| **InitiateCheckout** | ✅ | ✅ | ✅ | **ok** |
| **Purchase** (webhook) | — não passa por navegador | ✅ | n/a (só um caminho) | ⚠️ **identidade incompleta** |

Os quatro do topo estão corretos na forma. O `PageView` passa pelo
`api.track` em vez de um `fbq('track','PageView')` solto — certo, senão
sairia sem `eventID` e sem deduplicação.

**O Purchase é o problema, e é o evento que a Meta usa para otimizar.**

---

## 2. `user_data` — o que a Meta aceita × o que mandamos

Coluna "Meta" = campos que o `user_data.py` do SDK 26.0.2 monta.

| campo | hash? | Meta aceita | PageView/ATC/IC | **Purchase** |
|---|---|---|---|---|
| `em` e-mail | SHA-256 | ✅ | ⚠️ só se o site souber | ✅ **do gateway** |
| `ph` telefone | SHA-256 | ✅ | ⚠️ idem | ✅ **do gateway** |
| `fn` nome | SHA-256 | ✅ | ⚠️ idem | ✅ |
| `ln` sobrenome | SHA-256 | ✅ | ⚠️ idem | ✅ |
| `ct` cidade | SHA-256 | ✅ | ✅ do geo | 🔴 **FALTA** |
| `st` estado | SHA-256 | ✅ | ✅ do geo | 🔴 **FALTA** |
| `country` país | SHA-256 | ✅ | ✅ do geo | 🔴 **FALTA** |
| `external_id` | opcional | ✅ | ✅ `trck_user_id` | 🔴 **FALTA** |
| `zp` CEP | SHA-256 | ✅ | ❌ nunca | 🔴 **FALTA** |
| `fbp` | **nunca** | ✅ | ✅ | ✅ |
| `fbc` | **nunca** | ✅ | ✅ | ✅ |
| `client_ip_address` | **nunca** | ✅ | ✅ | ✅ quando o gateway manda |
| `client_user_agent` | **nunca** | ✅ | ✅ | 🔴 **FALTA** |
| `ge` gênero | SHA-256 | ✅ | ❌ não coletamos | ❌ |
| `db`/`dobd`/`dobm`/`doby` | SHA-256 | ✅ | ❌ | ❌ |
| `f5first`/`f5last`/`fi` | SHA-256 | ✅ | ❌ | ❌ |
| `subscription_id`, `lead_id` | não | ✅ | ❌ n/a | ❌ n/a |
| `ctwa_clid` Click-to-WhatsApp | não | ✅ | ❌ | ❌ |

### 🔴 O achado principal

**O Purchase manda MENOS identidade que um PageView.**

| evento | parâmetros de match |
|---|---|
| PageView | até **11** |
| Purchase | **7** |

E não é por falta de dado: `external_id` (do `trck_user_id`), `geo_city`,
`geo_region` e `geo_country` **já estão gravados na própria linha da
compra** — copiados do visitante no casamento. `dispararCompra()` só não os
passa para o `montarUserData()`.

Em `src/lib/compras.ts:365`, a chamada leva `emailHash`, `phoneHash`,
`firstNameHash`, `lastNameHash`, `fbp`, `fbc`, `ip` — e para por aí.
Compare com `src/app/api/event/route.ts:158`, que leva tudo.

**Custo de corrigir: nenhuma migration.** O dado está na linha.

---

## 3. Identificadores

| id | capturado | guardado | enviado | status |
|---|---|---|---|---|
| **`_fbp`** | ✅ cookie | `visitors.fbp` | ✅ em claro | **ok** |
| **`_fbc`** | ✅ cookie | `visitors.fbc` | ✅ em claro | **ok** |
| **`fbclid`** | ✅ da URL | ➜ vira `fbc` | ✅ como `fbc` | **ok** |
| **`ga_client_id`** | ✅ do `_ga` | `visitors.ga_client_id` | ✅ no MP | **ok** |
| **`ga_session_id`** | ✅ do `_ga_<id>` | `visitors.ga_session_id` | ✅ no MP | **ok** |
| **`gclid`** | ❌ | ❌ | ❌ | **não existe** |

### `fbclid` → `fbc`: está certo, e é mais importante do que parece

`lerOuMontarFbc()` monta `fb.1.<timestamp>.<fbclid>` quando o cookie `_fbc`
ainda não existe. Isso cobre o caso em que o Pixel não rodou (bloqueador, ou
o evento saiu antes do script carregar) — e é justamente o clique que liga a
venda à campanha. O formato bate com o que a Meta documenta.

### `gclid` não é capturado

Só aparece em um comentário de migration e numa fixture de teste — não há
coluna nem leitura. **Só importa se você rodar Google Ads**; para Meta é
irrelevante. Se um dia rodar, é o mesmo caminho do `fbclid`.

---

## 4. Hash — conferido linha a linha contra o `normalize.py` 26.0.2

| campo | `normalize.py` faz | `src/lib/hash.ts` faz | bate? |
|---|---|---|---|
| `em` | `lower().strip()` + valida `.+@.+\..+` | idem, exige `@` | ✅ |
| `fn`/`ln` | **sem ramo** → só `lower().strip()` | idem — apóstrofo fica | ✅ |
| `ct` | remove `[0-9.\s\-()]` | mesmo conjunto — **acento fica** | ✅ |
| `st` | idem `ct` | idem, **+ tira prefixo `BR-`** | ✅ ⭐ |
| `zp` | tira espaço, corta no `-` | `hashCep` faz exatamente isso | ✅ **mas órfã** |
| `country` | remove `[^a-z]`, valida ISO-2 | idem, exige 2 letras | ✅ |
| `ph` | tira `[\s\-()]`, tira `^\+?0{0,2}` | tira todo `\D`, tira zeros | ✅ ⭐ |
| `external_id` | **não normaliza nem hasheia** | hasheia | ⚠️ ver abaixo |
| `fbp`/`fbc`/`ip`/`ua` | nunca hasheados | nunca hasheados | ✅ |

⭐ = **desvio deliberado nosso, e está certo**:

- **`st`**: a Vercel manda `BR-SP`. Pela regra crua da Meta o hífen sai e
  sobra `brsp`, que não casa com nada. Tiramos o prefixo antes.
- **`ph`**: o regex do SDK (`^\d{1,4}\(?\d{2,3}\)?\d{4,}$`) **aceita**
  `11987654321` e trata o `11` como código de país — silenciosamente
  errado. Acrescentar o DDI `55` em números de 10-11 dígitos corrige isso.
  O SDK não faz; nós fazemos, e é o certo para formulário brasileiro.

⚠️ **`external_id`**: o SDK manda **em claro** (só deduplica a lista). Nós
hasheamos. A Meta aceita os dois — mas o docstring do SDK avisa: *"If
External ID is being sent via other channels, then it should be sent in the
same format via the Conversions API."* Hoje só mandamos por um canal, então
é consistente. **Se um dia mandar também pelo Pixel, os dois têm de usar a
mesma forma.**

### 🔴 `hashCep` está implementada, testada, e nunca é chamada

Função órfã em `src/lib/hash.ts:132`. O `zp` não existe no tipo
`UserDataCapi`, nenhum adaptador extrai CEP do gateway, e nenhuma coluna o
guarda. **O CEP é o parâmetro mais fácil de ganhar num checkout brasileiro**
— é obrigatório em todos eles.

---

## 5. O vinculador — webhook ↔ visitante

**Status: ok.** A escada é `trck_user_id` → `email` → `telefone`, para no
primeiro que casa, e grava o motivo em `purchases.match_method`
(constraint fecha em `trck_user_id`/`email`/`phone`/`nenhum`).

Provado por teste, não por leitura:

- tenta o `trck_user_id` primeiro e para no primeiro que casar
- cai para o e-mail quando não veio identificador
- cai para o telefone só depois do e-mail falhar
- registra `nenhum` quando não casa — órfã é resposta, não vazio
- o casamento roda **antes** do disparo (senão a conversão ia sem identidade)
- copia `fbp`, `fbc`, `ga_client_id` e o **geo do visitante**, nunca o IP do
  gateway

Duas travas que valem citar porque evitam vínculo inventado:

- o `cart_token` da Yampi é recusado como ponte — é hash, casaria com a
  regex de 32 hex e ligaria **toda** venda sem `metadata` a um fantasma;
- o `client_key: "merchant-key-123"` da Appmax idem.

---

## 6. Deduplicação Pixel ↔ CAPI

**Status: ok, e verificado no código que roda.**

`src/lib/snippet.ts:297` gera **um** `eventId` e o usa nos dois caminhos:

```js
var eventId = novoEventId();
w.fbq('track', nome, custom, { eventID: eventId });   // navegador
…
var corpo = { event_name: nome, event_id: eventId, … }; // servidor
```

O servidor repassa esse mesmo `event_id` no `user_data` da CAPI. A Meta vê
os dois, reconhece o id e fica com o mais completo.

No **Purchase do webhook** não há Pixel para deduplicar — o `event_id` é
derivado do `transaction_id`, portanto **estável**: reenvio do gateway ou
Reprocessar geram o mesmo id e a Meta deduplica. `sent_at` é a trava extra.

---

## 7. O que corrigir, em ordem

### 🔴 Alto — antes de rodar mídia

**1. Purchase com identidade completa** · `src/lib/compras.ts:365`
Passar `externalIdHash`, `cityHash`, `stateHash`, `countryHash` a partir do
que já está na linha. Sobe de 7 para 11 parâmetros no evento que mais
importa. **Sem migration.**

**2. `zp` (CEP) ponta a ponta**
Ligar a `hashCep` órfã: campo `zp` no `UserDataCapi`, extração do CEP nos 5
adaptadores, coluna em `purchases`. **Precisa de migration** — um
`ATUALIZAR` para você rodar.

### 🟠 Médio

**3. `event_time` da compra usa `Date.now()`** · `src/lib/compras.ts:360`
Deveria usar `purchases.created_at`, que existe. No fluxo normal a
diferença é de segundos; **no Reprocessar** uma venda de dias atrás vai com
a data de hoje — atribuída ao dia errado, e a Meta recusa evento com mais
de 7 dias.

**4. Advanced Matching do Pixel desligado** · `src/lib/snippet.ts:230`
`fbq('init', id)` sem o segundo argumento. Quando o site chama
`rrtrack.identify({email})`, o dado vai ao servidor e **não** ao Pixel.

**5. `external_id` não vai pelo Pixel**
Se entrar, tem de ir na mesma forma dos dois lados (ver §4).

### 🟡 Baixo / informativo

**6. `gclid`** — só se rodar Google Ads.
**7. `ge`, `db`, `f5first/f5last/fi`** — a Meta aceita, você não coleta.
Não vale pedir data de nascimento num checkout de dropshipping.
**8. `ctwa_clid`** — só se rodar Click-to-WhatsApp.

---

## Resumo

A **forma** está correta: dedup funciona, hash bate com a implementação de
referência da Meta em todos os campos, os identificadores são capturados e
guardados certo, o vinculador casa na ordem certa e o geo da compra vem do
visitante e não do datacenter do gateway.

O que falta é **volume de identidade no Purchase** — e o mais irônico é que
a maior parte do dado já está gravada na linha, só não é passada adiante.
