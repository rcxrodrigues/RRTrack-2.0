# RRTrack 2.0 — guia do projeto

Sistema de tracking **server-side** com painel próprio. Captura o visitante,
dispara os eventos pelo navegador **e** pelo servidor com o mesmo `event_id`
(deduplicado), casa a venda que chega pelo webhook de volta com quem a originou,
e cruza gasto de mídia com receita real para mostrar ROAS e CPA que fecham com
o caixa.

---

## Comandos

```bash
npm run dev         # servidor de desenvolvimento
npm run build       # build de produção (roda o typecheck junto)
npm run typecheck   # tsc --noEmit (compilador nativo em Go)
npm run lint        # oxlint com checagem de tipos
npm run test        # vitest
npm run check       # typecheck + lint + test — rode antes de todo commit
```

---

## Arquitetura de domínios

O painel vive num **subdomínio da oferta**. Isso não é detalhe de hospedagem —
é o que permite cookie de primeira parte. Primeira oferta em produção, com
DNS no Cloudflare e app na Vercel:

```
transforlar.com           loja Shopify (externa)
                          roda <script src="https://track.transforlar.com/t.js">
track.transforlar.com     ESTE app: painel + APIs de captura + webhook
checkout de terceiro      plataforma própria de checkout — outro site
gateway                   AppMax / Pagou.ai / MillionsPay processam o pagamento
```

> **A primeira loja é Shopify com checkout de terceiro**, não infoproduto. Isso
> não é detalhe: quem manda o webhook de venda é o checkout ou o gateway, não a
> Shopify, e o `trck_user_id` precisa atravessar para o domínio do checkout.

- **Cookie `_trck` com `Domain=.transforlar.com`** vale na LP e no painel. É
  cookie de primeira parte: o Safari não descarta e o ITP não corta em 7 dias.
- LP → painel é cross-**origin** (precisa de CORS) mas same-**site**, então o
  cookie viaja com `SameSite=Lax` + `credentials: 'include'`.
- O checkout é outro site, e por isso **o `trck_user_id` viaja na URL** do
  checkout e nos links de WhatsApp. É essa a ponte cross-domain.
- **Os domínios do checkout são configuração, não código** (`settings.
  checkout_domains`, cadastrados no painel). Nasceram como uma regex fixa de
  plataformas de infoproduto dentro do snippet — errado duas vezes: nenhuma
  delas aparece num funil Shopify, e cada oferta futura usa o checkout que
  quiser. O WhatsApp continua no código porque é universal e porque lá o id vai
  no **texto** da mensagem, não na query.
- **O acerto do domínio é por HOST, nunca por `indexOf` no href.** Uma busca de
  texto casaria com `https://golpe.com/?volta=checkout.loja.com` e mandaria o
  identificador do visitante para o domínio de quem montou o link.
  `src/lib/snippet-marcacao.test.ts` **executa** o snippet contra esses vetores
  — conferir o fonte por string não prova nada sobre comportamento.

CORS nunca fica aberto: a allowlist de origens é configurada no painel.

> **Cloudflare na frente da Vercel — cuidado com o geo.** Se o registro
> `track` ficar com o proxy ligado (nuvem laranja), a Vercel passa a ver o IP
> do Cloudflare e os cabeçalhos `x-vercel-ip-*` deixam de valer: perde-se o
> mapa por região e, pior, vai o IP errado para a Conversions API, o que
> degrada o match na Meta. O recomendado é **DNS only** (nuvem cinza) nesse
> registro. De todo modo `src/lib/geo.ts` detecta os dois conjuntos de
> cabeçalhos (Vercel e `CF-Connecting-IP`/`CF-IPCountry`), então funciona nas
> duas configurações e não quebra se mudar.

---

## Versões — e por que estão fixadas

Confira a documentação oficial antes de subir qualquer integração.

| Item | Versão | Observação |
|---|---|---|
| Next.js | 16.3.5 | `middleware.ts` virou **`proxy.ts`**; `params`/`searchParams` são Promises |
| React | 19.3.0 | |
| TypeScript | **7.0.2 (exata, sem `^`)** | Compilador nativo em Go — ver a seção abaixo |
| Tailwind CSS | 4.x | Config em CSS (`@theme`), **não existe `tailwind.config.js`** |
| Oxlint + tsgolint | 1.83 | Linter com tipos; o `typescript-eslint` **não** funciona no TS 7 |
| Vitest | 5.x | Compila com esbuild/Rolldown, não toca a API do TS |
| **Graph API / Marketing API** | **v26.0** | Lançada 29/07/2026 |
| GA4 Measurement Protocol | sem versão na URL | `/mp/collect`; debug em `/debug/mp/collect` |

> **Antes de escrever código de Next.js, leia `node_modules/next/dist/docs/`.**
> O pacote traz a documentação da versão exata que está instalada — `01-app`
> cobre o App Router. Vale mais que memória: o 16 mudou convenções (o
> `proxy.ts`, os Promises em `params`) e a doc local é a que corresponde ao
> código que vai rodar aqui.

### A constante única da Graph API

`src/lib/meta/constants.ts` é o **único** arquivo do projeto autorizado a citar
uma versão da Graph API ou o host `graph.facebook.com`. Para atualizar, troque
uma linha:

```ts
export const META_GRAPH_API_VERSION = 'v26.0' as const;
```

Um teste em `constants.test.ts` varre o `src/` e **quebra o build** se qualquer
outro arquivo escrever uma versão ou montar a URL à mão. Não contorne o teste —
ele existe para que subir de versão seja uma linha, não uma caça ao tesouro.

A Meta lança versão a cada ~4-6 meses e cada uma dura ~2 anos. Ao subir, leia o
changelog: mudanças de parâmetro da Conversions API e dos Insights vêm junto.

### TypeScript 7 — o que saber antes de mexer

O TS 7 trocou o compilador por um port nativo em Go. Ele **não expõe mais a API
programática** (a "Strada"): `ts.TypeFlags`, `ts.SyntaxKind` e afins vêm
`undefined`. Repare que `node_modules/typescript/lib/` tem só um shim — não há
`typescript.js`. A API nova chega no 7.1.

Consequências práticas, e o que fazemos:

- **Não instale `eslint` nem `typescript-eslint`.** Não funcionam com o TS 7.
  O linter é o `oxlint --type-aware`, construído sobre o TS 7.
- **Não instale `ts-morph`, `tsup --dts` ou `ts-jest`.** Todos dependem da API
  que não existe. Testes são Vitest.
- O `next.config.ts` tem `experimental.useTypeScriptCli: true`. **Sem essa flag
  o `next build` falha**, porque o backend padrão do Next chama a API ausente.
- O `typescript` está fixado em `7.0.2` **sem `^`** de propósito: queremos saber
  o dia em que uma atualização muda o comportamento, não descobrir por acaso.
- O `tsconfig.json` é deliberadamente válido também no TS 5.9 — sem
  `target: es5`, sem `moduleResolution: node`, sem `baseUrl`.

**Plano de recuo**, se o ferramental atrapalhar:

```bash
npm i -D typescript@5.9.3
# remover `experimental.useTypeScriptCli` do next.config.ts
# trocar o oxlint por eslint + eslint-config-next
```

Nenhuma linha de código da aplicação muda.

---

## Segurança — as regras que não se negociam

1. **RLS em todas as tabelas.** Política de `SELECT` para `authenticated`;
   **nenhuma** política de escrita. Sem política de escrita ninguém escreve pelo
   cliente — nem por engano. Quem grava é o `service_role`, que ignora RLS.
2. **`service_role` só no servidor.** Exclusivamente via
   `src/lib/supabase/admin.ts`, em Route Handlers e Server Actions. Se aparecer
   num componente cliente, é bug de segurança, não detalhe de estilo.
3. **Nada sensível com `NEXT_PUBLIC_`.** Esse prefixo publica a variável no
   bundle do navegador.
4. **Cadastro público desligado** no Supabase Auth. Usuários são criados à mão.
5. **Todo endpoint público valida com Zod e tem rate limit.** Sem exceção.
   O webhook exige `webhook_token` além disso.
6. **Validação é sempre no servidor.** O que vem do navegador é sugestão.
7. **`.env*` está no `.gitignore`.** Se um segredo for commitado, ele vazou:
   rotacione a chave, não apenas apague o arquivo.

### Credenciais: pelo painel, não pelo env

Só a infra do Supabase mora em variável de ambiente (`.env.example` lista as
três). Tokens da Meta, `api_secret` do GA4 e o token de webhook são cadastrados
**pelo painel** e ficam guardados no cofre do Supabase:

| Tabela | Conteúdo |
|---|---|
| `settings` | linha única: `webhook_token`, `currency`, `test_event_code`, origens permitidas |
| `ga4_accounts` | N propriedades GA4: `measurement_id` + `api_secret` |
| `meta_pixels` | N pixels: `pixel_id` + `capi_token` |
| `meta_ad_accounts` | N contas de anúncio: `ad_account_id` + `ads_token` |

Os eventos são enviados a **todos** os destinos ativos, e a resposta de cada um
é gravada no log do evento.

### Cifra dos segredos — Supabase Vault

Os tokens vivem no **Supabase Vault**. As tabelas guardam só o **UUID** que
aponta para o segredo; o valor nunca passa por uma coluna nossa.

```
public.meta_pixels.capi_token_secret_id  ──▶  vault.secrets (cifrado em disco)
                                              chave-mestra FORA do Postgres
```

Interface, toda `security definer` e só para o `service_role`:

| Função | Faz |
|---|---|
| `private.guardar_segredo(id_atual, nome, segredo)` | cria na primeira vez, atualiza depois — devolve o UUID |
| `private.ler_segredo(id)` | abre o cofre |
| `private.esquecer_segredo(id)` | remove do cofre |

Apagar uma conta dispara um trigger que tira o segredo do cofre junto. Sem
isso, cada conta removida deixaria um token vivo lá para sempre.

**Por que não foi `pgp_sym_encrypt` com chave nossa**, como estava no plano:
a ideia era guardar a chave no catálogo via
`ALTER DATABASE ... SET app.settings.encryption_key`. **O Supabase não
permite** — esse comando exige privilégio de dono do banco, que o role
`postgres` de um projeto não tem (erro `42501`). Não há contorno.

E o Vault é melhor do que a ideia original: a chave-mestra vive **fora** do
Postgres, então nem `pg_dump`, nem `pg_dumpall`, nem um backup vazado
decifram nada. Era exatamente o limite que a abordagem anterior aceitava.

**Testando localmente:** o Vault não existe num Postgres comum, então
`supabase/tests/00_ambiente_supabase.sql` traz um **substituto que NÃO cifra**
— ele existe só para exercitar a lógica (guardar, ler, atualizar sem criar
órfão, limpar ao apagar). A cifra em si é responsabilidade do Vault e se
verifica no Supabase.

---

## Design system

### A marca

O azul vem do logo, **medido** pixel a pixel e não escolhido no olho:
`hsl(226 100% 50%)` (#0037FF) é o tom dominante, e o gradiente do símbolo vai
daí até o ciano `hsl(185 85% 60%)`.

### Dois tokens por cor, quando os papéis conflitam

`--primary` e `--primary-vivid` não são redundância. A cor da marca tem dois
usos com exigências **opostas**, e nenhum tom único atende aos dois:

| uso | precisa contrastar com | valor (escuro) |
|---|---|---|
| fundo de botão | o texto branco em cima | `224 100% 60%` → 4.54:1 |
| texto, link, item ativo | o fundo da página | `224 100% 64%` → 5.11:1 |

Em 60% o texto reprova (4.36:1); em 62% o botão reprova. As faixas não se
cruzam. O mesmo vale para `--destructive` / `--destructive-vivid`.

**Regra:** cor da marca em superfície → `--primary`; em texto ou ícone →
`--primary-vivid`.

### Como mexer numa cor sem quebrar nada

1. `npm run test` — `src/app/globals.test.ts` lê o `globals.css` e audita
   **todo** token: contraste de texto contra o fundo, de superfície contra o
   texto em cima, e separação ΔE entre as séries de gráfico. Foi escrito
   depois de uma primária ir para produção com 4.36:1 porque a conta foi feita
   à mão e lida como aprovada.
2. Para **cor de gráfico**, rode também o validador da skill `dataviz`: ele
   checa banda de luminosidade OKLCH, piso de croma e separação sob
   daltonismo, que contraste sozinho não pega.
3. Abra **/estilo** no painel — ele lê os tokens aplicados e mostra os números
   ao vivo, nos dois temas.

> Contraste e distinguibilidade são perguntas diferentes. Azul e âmbar têm
> luminância parecida (1.07:1) e ninguém os confunde — o que os separa é o
> matiz. Para séries de gráfico a métrica é **ΔE em OKLab** (piso 15), nunca
> razão de contraste.

### O resto

- **Cores em HSL** em variáveis CSS — `224 100% 60%`, sem a função `hsl()` em
  volta, para permitir `hsl(var(--primary) / 0.3)`. O shadcn novo usa OKLCH;
  aqui é HSL de propósito. Ao trazer um componente do shadcn, converta.
- **Escuro é o padrão.** O `<html>` já nasce com `class="dark"` no SSR, então o
  tema certo aparece antes do JS — e continua certo se o JS não carregar.
- **O "RRTrack" do cabeçalho é texto, não imagem.** O lettering do arquivo da
  marca é branco e sumiria no tema claro. Em texto ele acompanha o tema, é
  selecionável e é lido por leitor de tela. Só o símbolo é imagem
  (`public/marca/rr-icone.webp`), sobre um selo escuro que vale nos dois temas
  — ele também tem partes brancas.
- **Inter** no texto e nos números; **JetBrains Mono** reservada a id, token,
  JSON e código. A Inter tem numerais tabulares de verdade, então a métrica
  grande fica nela: mais legível em corpo grande que a monoespaçada.
  **Todo número usa `font-variant-numeric: tabular-nums`** (classe `.tabular`
  ou `data-slot="metric"`), para a métrica não dançar ao atualizar.
- **Duas camadas, e a diferença importa.** `.glass` é translúcido (55% no
  escuro) e serve a **cartão de conteúdo**, que assenta no fundo da página.
  `.flutuante` é a mesma cor e a mesma borda, porém **opaca**, e serve ao que
  flutua sobre texto: menu, diálogo, toast. O seletor de moeda nasceu com
  `.glass` e o formulário aparecia through das opções.
  Ao trazer um componente que abre por cima de algo, é `.flutuante`.
- **Sombra vem da camada, não de uma utilitária.** `.flutuante` vive em
  `@layer components`, e as utilitárias do Tailwind (`shadow-lg`) vêm depois
  — pôr as duas no mesmo elemento faz a utilitária vencer e a elevação
  desaparecer.
- **Mobile-first.** Alvos de toque ≥ 44px (o `size="default"` do Button já dá
  `h-11` no celular). Sidebar no desktop, barra inferior no celular —
  `src/lib/nav.ts` é a fonte única das duas.
- Métrica sem dado mostra **`—`, nunca `0`**: zero é um número, "sem dado" não é.
  É o que o `MetricCard` faz quando recebe `value={null}`.

---

## Captura — o que não pode regredir

Os três endpoints públicos (`/t.js`, `/api/identify`, `/api/event`) compartilham
um portão único, `prepararCaptura()` em `src/lib/captura.ts`: allowlist de
origem, rate limit e leitura do contexto. É centralizado porque o modo de falha
clássico é um endpoint novo nascer sem uma das travas — quem escreveu esqueceu
de copiar.

**As duas falhas são deliberadas e opostas.** Vale saber por quê antes de
"consertar" alguma delas:

| trava | falha para | porque |
|---|---|---|
| CORS | **fechado** | allowlist vazia bloqueia tudo. Um endpoint de captura aberto deixa qualquer site do mundo gravar no seu banco |
| rate limit | **aberto** | se o próprio limitador cai, a captura do site inteiro pararia. Estes endpoints gravam — não expõem nem apagam nada |

- **Recusa é `recusar()`, sucesso é `responder()`.** Passar `{ erro }` para a
  de sucesso devolvia `{"ok":true,"erro":…}` com status 200: um corpo que se
  contradiz e um status que mente. Payload inválido é **400**; falha ao gravar
  o evento é **500**.
- **Toda recusa leva os cabeçalhos de CORS.** Sem eles o navegador esconde o
  429 atrás de um erro de CORS e ninguém descobre que era rate limit.
- **O corpo da recusa diz o CAMPO, não a mensagem do Zod.** O campo ajuda quem
  instala o snippet; a mensagem descreve o nosso schema por dentro. O detalhe
  vai para o log.
- **`_trck` é `httpOnly: false` de propósito** — o snippet precisa ler o valor
  para pendurá-lo nos links de checkout e de WhatsApp. Não é descuido.
- **O cache de `settings` guarda também a falha**, por 5 segundos. Sem isso,
  numa queda do Supabase cada pageview do site esperava o timeout da conexão.
- **`/t.js` não tem allowlist** — tag de script não manda `Origin`, e o arquivo
  só contém ids de GA4 e de pixel, que qualquer visitante já enxerga. Token
  nenhum passa por ali.

### Hash para a CAPI: siga o `normalize.py`, não a prosa

A Meta compara o nosso hash com o que ela calcula do lado dela. Normalizou
diferente → os hashes não batem → o evento chega sem identificação, **sem erro
e sem aviso**, só com match pior. É a falha mais silenciosa do projeto inteiro.

A página de parâmetros diz "sem pontuação, sem caracteres especiais". O
`normalize.py` do SDK oficial — que é a implementação de referência — faz outra
coisa, e é ela que vale:

| campo | a Meta faz | consequência |
|---|---|---|
| `fn` / `ln` | **nada** além de minúsculas e trim | `O'Brien` → `o'brien`. Tirar o apóstrofo aqui quebra o match |
| `ct` / `st` | remove só `[0-9.\s\-()]` | `São Paulo` → `sãopaulo` — **o acento fica**; `Coeur d'Alene` → `coeurd'alene` |
| `zp` | tira espaços, corta no primeiro hífen | `01310-100` → `01310`. **Letras ficam** — postcode britânico é letra e número |
| `em` | minúsculas e trim | |
| `ph` | só dígitos, sem `+` nem zeros de discagem | acrescentamos o DDI `55` quando vêm 10-11 dígitos: formulário brasileiro não pede código de país |

Exceção nossa, e única: `st` tira o prefixo do país **antes** da limpeza. O
`BR-SP` que a Vercel manda viraria `brsp` pela regra da Meta, que não casa com
nada. Testes com estes vetores em `src/lib/hash.test.ts`.

**Nunca hasheados:** `fbp`, `fbc`, `client_ip_address`, `client_user_agent`.
Hashear qualquer um deles o torna inútil.

---

## Destinos server-side — as regras do envio

O evento sai por dois caminhos: o Pixel no navegador e a Conversions API aqui.
O que impede a conversão de contar em dobro é o `event_id` ser **idêntico** nos
dois — a Meta recebe os dois, vê o mesmo id e fica com o mais completo.

- **O disparo roda em `after()`**, depois da resposta. Quem chama `/api/event` é
  o navegador de quem está comprando; segurar a página por uma ida à Meta seria
  trocar velocidade de loja por conveniência nossa. Medido: resposta em 258ms
  com o disparo terminando em 2063ms.
- **`Promise.allSettled`, nunca `all`.** Com `all`, um pixel de token vencido
  faria o evento sumir dos outros destinos. `src/lib/destinos.test.ts` prova
  isso executando o fan-out, não lendo o código.
- **200 com `events_received: 0` é FALHA.** A Meta aceita a chamada e descarta
  o evento; contar como sucesso esconderia no log justamente o caso que
  precisa aparecer.
- **O token vai no CORPO do POST, nunca na query.** Query string aparece em log
  de proxy e em histórico de erro, e este token escreve no pixel.
- **O `payload_meta` gravado não tem o token.** O segredo entra só na hora do
  `fetch` e nunca encosta na linha do log — que é auditoria, e um token ali
  seria segredo vazado em repouso.
- **O `test_event_code` é omitido quando vazio, nunca mandado em branco.**
  Esquecido preenchido em produção, ele manda toda conversão para Test Events,
  onde ela não conta: o otimizador da Meta para de aprender e a campanha morre
  sem ninguém entender por quê.
- **`event_time` em SEGUNDOS.** Com milissegundos a Meta recusa dizendo só que
  o horário está fora da janela.
- **Os hashes vêm prontos do banco**, não são calculados no envio: normalizar
  em dois lugares é garantir que um dia os dois divergem — e o dia em que isso
  acontecer, o match cai sem ninguém notar.
- **O visitante é buscado sempre que há identificador**, não só quando falta
  UTM. É dele que saem os hashes e o `fbp`/`fbc` que dão à Meta alguém para
  casar; sem isso o evento chega sem identificação.
- **`ignoreDuplicates` com `.select()`.** O conflito devolve lista vazia, e é
  assim que se sabe se a linha é nova. Sem essa distinção, um beacon reenviado
  dispararia a Meta de novo e sobrescreveria a resposta já gravada.

### O GA4 NÃO entra no `/api/event`

O que acontece no navegador já foi pela gtag.js que o snippet carrega. O
Measurement Protocol **não deduplica** como a Meta faz com o `event_id`:
mandar o mesmo evento por lá conta duas vezes no relatório.

`src/lib/ga4/mp.ts` existe para a **compra do webhook** (Fase 5), que acontece
noutro site e nunca passou por gtag nenhuma. Ele reaproveita o `client_id` e o
`session_id` da visita — sem eles o GA4 abre sessão nova e a compra vira
tráfego direto, desligada do anúncio que a trouxe.

### Cache de token

O token do cofre fica 60s em memória. Sem isso, cada evento de cada visitante
viraria uma leitura `security definer` no Postgres por pixel. O token já vive
na memória da instância durante o envio; o cache só estende por um minuto, e
nunca é logado. Toda mutação no painel chama `esquecerCaches()` — que vale só
para a instância que atendeu, e é por isso que os TTLs são curtos.

---

## Autenticação — o que não pode quebrar

- **`setAll` recebe DOIS parâmetros** no `@supabase/ssr` 0.12: `(cookies,
  headers)`. O segundo traz `Cache-Control: private, no-cache, no-store…`, e
  ele **precisa** ser aplicado na resposta. Sem isso, um CDN (a Vercel é um)
  pode cachear uma resposta com `Set-Cookie` de sessão e servir o token de um
  usuário para outro. Exemplos na internet usam a assinatura antiga, de um
  parâmetro só — não copie de lá. Ver `src/lib/supabase/proxy.ts`.
- **Um cliente novo por requisição.** Reaproveitar deixa as respostas
  seguintes sem os cabeçalhos de cache.
- **`getClaims()`**, não `getSession()` nem `getUser()`: valida a assinatura
  do JWT localmente, sem uma ida ao servidor de Auth a cada verificação.
- **O `proxy.ts` é checagem otimista**, só lê o cookie — ele roda em toda
  navegação, inclusive nas que o Next prefetcha. Quem autoriza de verdade é o
  `layout.tsx` do `(dash)`, com `usuarioAtual()`.
- **`shouldCreateUser: false`** no `signInWithOtp`. É a trava de cadastro no
  código; a do painel do Supabase é a segunda.
- **A tela de login responde igual** existindo ou não o e-mail — senão ela
  vira um verificador de quem tem acesso.
- **Todo redirect passa por `caminhoInterno()`** (`src/lib/rotas.ts`). É o que
  impede transformar nosso domínio em trampolim de phishing. Tem teste com os
  vetores de ataque.

## Banco — como mexer com segurança

- **O SQL Editor do Supabase envia só as 100 primeiras linhas.** Script mais
  longo chega cortado ao banco, e o erro que aparece é o sintoma (um bloco
  `$$` "não terminado", porque o fechamento ficou fora do corte), não a causa.
  Por isso existe `supabase/INSTALAR-COMPACTO.sql`: mesmo conteúdo em 18
  linhas, gerado por `supabase/tests/gerar-compacto.py`. Regere depois de
  mexer nas migrations — a equivalência é verificada comparando o catálogo
  dos dois bancos, objeto a objeto.
- Migrations em `supabase/migrations/`. Rode `./supabase/tests/aplicar.sh`
  antes de commitar: aplica tudo num Postgres limpo e roda as asserções de
  segurança. O CI roda o mesmo a cada push.
- **Privilégio de coluna não sobrepõe privilégio de tabela.** Como o Supabase
  concede `SELECT` na tabela inteira, um `revoke select (coluna)` isolado não
  faz nada. Para esconder uma coluna: `revoke all on <tabela>` e depois
  `grant select (colunas seguras)`. Foi assim que os tokens cifrados saíram do
  alcance do painel — e a asserção 3 do teste existe para isso não regredir.
  **O outro lado da mesma armadilha:** coluna NOVA nasce invisível para o
  painel até alguém escrever o `grant select (coluna)`, e a tela quebra com
  "permission denied". A asserção 3d guarda esse lado.
- `security definer` sempre com `set search_path = ''`, e tudo qualificado
  (`public.`, `private.`, `extensions.`).
- O passo a passo de ligar um projeto novo está em `supabase/README.md`.

## Convenções

- Código e comentários em **português**. Nomes de tabela e coluna em inglês
  (`visitors`, `events_log`), como já estão especificados.
- Migrations em `supabase/migrations/`, numeradas e **nunca editadas depois de
  aplicadas** — corrija com uma migration nova.
- Toda entrada pública tem um schema Zod no mesmo arquivo do handler.
- Log de erro nunca imprime segredo, token ou payload inteiro com dado pessoal.
- `npm run check` antes de cada commit.

---

## Estado das fases

- [x] **Fase 0** — Fundação e design system
- [x] **Fase 1** — Banco, RLS e autenticação (magic link)
- [x] **Fase 2** — Configuração das contas pelo painel
- [x] **Fase 3** — Captura (`/t.js`, `/api/identify`, `/api/event`)
- [x] **Fase 4** — Destinos server-side (Meta CAPI + GA4)
- [ ] **Fase 5** — Webhook de compra (AppMax / Pagou.ai / MillionsPay)
- [ ] **Fase 6** — Dashboard
- [ ] **Fase 7** — Campanhas (Meta Ads Insights + ROAS)
- [ ] **Fase 8** — Retenção, auditoria e publicação

Cada fase termina em commit e espera aprovação antes da seguinte.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
