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

         ┌─ CHECKOUT ──────────────┐   ┌─ GATEWAY ────────────────────┐
o funil: │ Yampi · Adoorei · Zedy  │ → │ AppMax · Pagou · MillionsPay │
         └─────────────────────────┘   └──────────────────────────────┘
           dono da página de pagamento   processa o dinheiro
```

> **São DUAS camadas, e as duas mandam webhook.** É a distinção que mais
> importa aqui. O checkout é dono da página onde a pessoa digita o cartão; o
> gateway processa. O payload da Adoorei confirma, trazendo
> `"gateway": "appmax|mercadopago|pagarme|…"` dentro do pedido.
>
> **Configure o webhook em UMA camada só — a do checkout.** Ele está mais
> perto do comprador: tem as UTMs, tem o campo livre da atribuição
> (`src`/`sck`, `metadata`, `informations`) e tem os dados do cliente. O
> gateway muitas vezes não vê nada disso.
>
> Com as duas apontando para cá, a mesma venda entra duas vezes com ids
> diferentes e vira **duas conversões na Meta**. A Appmax confirma que o
> risco é real: ela **suprime** o webhook dela quando o pedido veio da
> Yampi, de propósito. `acharDuplicataDeOutraCamada` em
> `src/lib/compras.ts` é a rede de segurança para quando a configuração
> escapar.

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
  checkout_domains`, cadastrados no painel), **e o nome do parâmetro junto
  com eles**: cada linha é `dominio` ou `dominio|parametro`. A Yampi só
  aceita `metadata[trck_user_id]`; a Zedy usa `src`/`sck`. Mandar o nome
  errado **não dá erro** — o checkout ignora, a venda entra e chega sem
  atribuição. Cravar o nome no código repetiria, numa porta nova, o erro que
  o parágrafo seguinte descreve. Nasceram como uma regex fixa de
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
- **Data em componente que passa por SSR: nunca `toLocaleString` direto.** O
  servidor roda em UTC (a Vercel roda) e o navegador no fuso de quem olha —
  os dois produzem textos diferentes para a mesma linha e a hidratação
  quebra. O padrão é renderizar algo **determinístico** (UTC derivado do
  texto ISO, sem passar por `Date`) e deixar o cliente mostrar o horário
  local. O mecanismo é o **`useSyncExternalStore`**, que aceita um retrato
  do servidor e outro do cliente — não `setState` num efeito, que dispara
  render em cascata e o lint recusa. Ver `Quando` em
  `src/app/(dash)/eventos/_components/webhook-recebido.tsx`.
- **Mobile-first.** Alvos de toque ≥ 44px (o `size="default"` do Button já dá
  `h-11` no celular). Sidebar no desktop, barra inferior no celular —
  `src/lib/nav.ts` é a fonte única das duas.
- Métrica sem dado mostra **`—`, nunca `0`**: zero é um número, "sem dado" não é.
  É o que o `MetricCard` faz quando recebe `value={null}` — e o que a etapa
  `desconhecido` do funil faz quando o evento que a alimenta nunca chegou.
  **Foi a captura de tela que pegou essa**: o funil mostrava `0,0%` logo acima
  de um aviso dizendo "não porque ninguém passou por lá". O número contradizia
  o texto.
- **Número na tela nunca passa por `Intl.NumberFormat`.** Ele depende do ICU, e
  o do Node não é o do navegador: em moeda pt-BR a diferença é o tipo de espaço
  depois do "R$" — o texto parece igual, o React vê diferente, e a hidratação
  quebra. `src/lib/formato.ts` formata à mão, com vetores em `formato.test.ts`.
  É a mesma armadilha do `toLocaleString` em data, por outra porta, e pior:
  o erro depende de qual navegador abriu a página.

### Gráfico: a cor é computável, então compute

Antes da primeira linha de gráfico, carregue a skill **`dataviz`**. Ela traz o
procedimento (forma → cor → validar → marcas → interação → acessibilidade →
**olhar**) e o validador.

O que já foi feito e não precisa repetir, salvo se mexer nos tokens:

```bash
node <skill>/scripts/validate_palette.js \
  "#3d71ff,#00999e,#9d7b0b,#b710fe,#e60579" --mode dark  --surface "#070a12"
node <skill>/scripts/validate_palette.js \
  "#2e66ff,#0299a1,#9c7002,#b903dd,#e00040" --mode light --surface "#fcfcfd"
```

Os cinco `--chart-*` passam nos seis checks nos dois temas, contra as
superfícies REAIS (não as padrão do validador). O `globals.test.ts` cobre ΔE e
contraste; o validador cobre banda de luminosidade, piso de croma e separação
sob daltonismo, que contraste sozinho não pega.

**Funil e lista ranqueada usam UMA cor.** As etapas não são identidades
diferentes — são a mesma quantidade encolhendo, e quem carrega a magnitude é o
comprimento da barra. Matiz por etapa gastaria três cores para não dizer nada.
Série única também não pede legenda: o rótulo já está na barra.

> **Neste ambiente a foto tem de ser do BUILD, não do `next dev`.** O
> websocket de HMR não atravessa o proxy de saída, e sem ele a hidratação não
> completa: o componente aparece certo e **não responde a clique**. Passei um
> tempo achando que o `onClick` estava errado. Para conferir qualquer coisa
> interativa: `npm run build && npx next start -p 3100`.

**O passo 7 da skill é literal: renderize e olhe.** O validador checa cor, não
layout. Sem credenciais do Supabase dá para montar uma rota `previa` temporária
com dados falsos, liberar o caminho em `ROTAS_PUBLICAS`, tirar a foto com o
Playwright nos dois temas e em 390px, e apagar tudo depois. Três problemas
saíram dessa foto e nenhum teste os pegaria: o `0,0%` acima, uma seta `↓` ao
lado de `10,6%` que lia como "caiu 10,6%" quando o número era o que PASSOU (a
seta virou `↳` e o texto virou "seguiram"), e `R$ 37.158,70` partindo em duas
linhas no celular com o "R$" sozinho parecendo outro número.

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

## Webhook de compra — o que os gateways impõem

`/api/webhook/compra?token=…`. Um endpoint só para todos os gateways; quem
reconhece o formato é o adaptador, não configuração no painel — pedir para
alguém declarar qual gateway é qual seria mais uma coisa para errar às três da
manhã. Adaptador novo entra em `ADAPTADORES` e em mais lugar nenhum.

- **O token é aceito em TRÊS lugares**, porque cada gateway escolheu o seu:
  `?token=` (Appmax e Pagou, que não mandam header nenhum),
  `x-webhook-token` (para quem não deixa pôr query na URL) e
  `Authorization: Bearer` (a Zedy documenta assim). Nem todo painel deixa
  escolher, e é isso que permite um endpoint só atender a todos.
  Comparação em tempo constante
  (`timingSafeEqual` sobre SHA-256 dos dois), senão o tempo de resposta vaza o
  prefixo correto e o token se reconstrói caractere a caractere.
- **Responder ANTES de trabalhar.** A Appmax dá **5 segundos**; estourou, ela
  reenvia, e depois de 4 tentativas descarta em definitivo **sem avisar**.
  Casar a venda e disparar os destinos acontece em `after()`.
- **Os códigos de resposta são deliberados**, porque cada um comanda o retry
  do gateway:

| situação | resposta | porquê |
|---|---|---|
| token errado | **401** | recusa mesmo, e retry não conserta |
| formato que nenhum adaptador lê | **202** | reenviar 4 vezes o que não sabemos ler falha 4 vezes igual |
| evento que não é venda | **200** | tratado, e não havia nada a fazer |
| falha nossa ao gravar | **500** | aqui o retry é exatamente o que queremos |

- **Uma linha por PEDIDO, não por evento.** Um cartão na Appmax dispara
  `order_authorized` → `order_approved` → `order_paid` → `order_integrated`,
  todos com o mesmo `order_id`. Upsert por `transaction_id`, prefixado pela
  plataforma (`appmax:3531`), porque o pedido 3531 da Appmax e o da Pagou não
  são o mesmo.
- **Campo vazio não apaga o que já estava:** o evento de estorno pode vir sem
  os dados do cliente que o de aprovação trouxe.
- **A ordem dos eventos não é garantida** — a Appmax diz isso com todas as
  letras. `order_refund` pode chegar antes de `order_approved`.
- **O status só AVANÇA — nunca volta.** `SUBSTITUI`, em
  `src/lib/webhooks/tipos.ts`, diz o que cada status tem autoridade para
  sobrescrever, e o filtro vai no `where` do update (atômico no Postgres),
  não num `if` depois de ler. "O último evento vence" erra o faturamento nos
  dois sentidos:

  | o que acontece | sem a escada | efeito |
  |---|---|---|
  | estorno, e depois o gateway REENVIA a aprovação | volta a `aprovada` com `reverted_at` preenchido | **infla** a receita: venda devolvida reaparece |
  | duas tentativas de cartão, e a recusa chega depois da aprovação | vira `recusada` | **perde** a receita: sai do ROAS, que é sobre `aprovada` |

  `recusada` sobrescreve `pendente`, e `aprovada` sobrescreve `recusada` —
  a segunda tentativa de cartão pode dar certo. Para trás, ninguém passa.

  **O status trava; o resto dos dados, não.** Um evento atrasado ainda pode
  trazer o cliente que o anterior não trouxe, e é gravado — só não mexe no
  status. `processar.test.ts` exercita a escada contra um banco de mentira
  que guarda estado, porque o que decide é um `where` que roda no banco:
  ler o código não provaria nada.

### Valores: sempre centavos, com uma exceção

Appmax e Pagou mandam tudo em centavos (`25990` = R$ 259,90). **A exceção:** em
evento de ASSINATURA da Appmax, `products[].price` vem em **reais** (`100.0`).
Mesma chave, unidade diferente, mesmo gateway. É por isso que a conversão fica
em `deCentavos()` e os eventos de assinatura são ignorados.

### Status: quem manda é o evento na Appmax, o campo na Pagou

A Appmax documenta **40 eventos** exaustivamente e **não publica a lista de
status** — nos exemplos só aparecem `aprovado` e `aguardando_pagamento`.
Decidir por um campo cuja enumeração ninguém conhece é escolher ser
surpreendido, então o adaptador decide pelo `event`.

A Pagou é o contrário: o OpenAPI publica os **17 status** numa enumeração
fechada, e aí o campo é confiável.

**A Yampi é um terceiro caso, e o pior:** os aliases de status dela **são
configuráveis por loja**. Não existe lista fixa — o suporte confirmou
(22/09/2026) que a única forma de saber os da sua loja é chamar
`GET /{alias}/checkout/statuses`. Uma loja pode renomear o estorno para
`devolvido`, ou criar `em_separacao`.

Um mapa fixo no código está errado por desenho, então o mapa é
**configuração** (`settings.status_aliases`, cadastrado no painel), e o que
está no adaptador é só **padrão de fábrica** — o cadastro passa por cima.
O estrago que isso evita é específico e silencioso: um alias de estorno que
não bate com o nosso faria o `refund` **nunca** chegar ao GA4, e o
faturamento ficaria inflado por uma venda que voltou para o cliente.

O `status` do cadastro é validado contra os cinco **duas vezes** — no Zod do
painel e na leitura em `settings.ts`. Texto livre ali atravessaria o mapa, o
adaptador e o disparo, e chegaria à Meta como conversão de um tipo que não
existe.

Onde o **evento** já responde, ele ganha: `order.paid` e
`transaction.payment.refused` são da Yampi, não da loja, e não passam pelo
alias. Se passassem, uma loja com status renomeado perderia a venda paga —
que é o que mais importa.

### Centavos OU reais — depende do gateway

**Não existe regra global.** Cada adaptador decide, e errar é invisível:

| gateway | unidade | exemplo |
|---|---|---|
| Appmax | **centavos** | `25990` = R$ 259,90 |
| Pagou | **centavos** | `25990` = R$ 259,90 |
| **Zedy** | **centavos** | `9700` = R$ 97,00 (`priceInCents`) |
| **Yampi** | **reais** | `199.90` = R$ 199,90 |
| **Adoorei** | **reais** | `110.00` = R$ 110,00 |

**Bruto, nunca líquido.** A Zedy manda os dois: `totalPriceInCents` é o que o
cliente pagou, `userCommissionInCents` é o que sobra depois da taxa. Para
ROAS vale o bruto — usar o líquido faria o retorno parecer menor do que é e
a campanha ser cortada à toa.

Aplicar `deCentavos()` num valor em reais dá R$ 1,10 no lugar de R$ 110,00 —
erro de 100× que não quebra nada e só aparece semanas depois, num ROAS
absurdo que ninguém sabe explicar. Cada `*.test.ts` trava a unidade do seu.

### Yampi e Adoorei usam o MESMO envelope

As duas mandam `{event, time, merchant, resource}` com eventos `order.*`.
Um adaptador engoliria o payload do outro e leria tudo errado — valor num
campo que não existe, cliente vazio, status que não bate.

O que separa: a **Yampi embrulha toda relação em `.data`**
(`status.data`, `customer.data`, `items.data`); na Adoorei `status` é texto
puro e `customer` é objeto plano.

Os dois `reconhece` checam isso **explicitamente**, nos dois sentidos —
depender da ordem do registro seria frágil, bastaria alguém reordenar a
lista para quebrar em silêncio. `yampi.test.ts` prova a separação nas duas
direções, e foi ele que pegou a colisão.

### A ponte da atribuição, por gateway

| gateway | onde o `trck_user_id` volta |
|---|---|
| Appmax | `client_key` / `external_key` — no envelope e dentro de `data` |
| Pagou | `informations[]` (chave/valor, documentado como "echo on the webhook") ou `correlation_id` |
| Yampi | `metadata.data[]` — e **só** ele. O link tem de levar `?metadata[trck_user_id]=…`, **na URL do checkout**; na da loja não vale. Confirmado pelo suporte em 22/09/2026 |
| Zedy | `trackingParameters.src` ou `.sck` — genéricos, ao lado das cinco UTMs |
| Adoorei | **não documenta saco de metadados** — sobra `source_reference`. Em compensação, o pedido traz o cliente completo, então o plano B por e-mail funciona |

> **O `cart_token` da Yampi NÃO serve de ponte, e aceitá-lo faz estrago.**
> Ele é o identificador do carrinho — mas é um hash, e hash tem hexadecimal
> de sobra para casar com a regex de 32. Aceitá-lo faria **toda** venda sem
> `metadata` nascer com um vínculo inventado: não casaria com visitante
> nenhum, e a linha ficaria com cara de atribuída sendo órfã. É a mesma
> armadilha do `client_key: "merchant-key-123"` da Appmax, por outra porta.
>
> E o saco `metadata` volta inteiro, com o `cart_id` e o que mais o checkout
> tiver posto lá: o valor só vale se a **chave** for nossa. Ler o primeiro
> que pareça um hash ligaria a venda a um fantasma.

### A mesma venda pelas duas camadas

Checkout e gateway podem os dois mandar webhook do mesmo pedido, com
`transaction_id` diferente — e o `event_id` de cada um sai do seu próprio
id, então a Meta **não** deduplica: contam duas.

`acharDuplicataDeOutraCamada` exige que **quatro** coisas batam: mesmo
e-mail, mesmo valor, plataforma diferente e dentro de meia hora. Exigir as
quatro é deliberado — duas compras iguais, do mesmo e-mail, pelo mesmo
valor, em camadas diferentes e em trinta minutos é configuração duplicada,
não cliente entusiasmado.

Faltando e-mail ou valor, **envia**: errar para o lado de não enviar custa
aprendizado; enviar duas vezes custa aprendizado ERRADO e ainda infla o
faturamento. A linha continua gravada nos dois casos — o que não sai duas
vezes é a conversão.

### Pedido de teste não vira conversão

A Zedy marca com `isTest`. Mandar um teste à Meta como `Purchase` ensina o
otimizador a perseguir venda que não existe, e infla o faturamento do painel.
O adaptador descarta com aviso; o payload fica em `webhooks_recebidos`.

Os outros quatro não documentam marca de teste — quando algum documentar,
o descarte entra no adaptador dele do mesmo jeito.

### A compra indo para os destinos

`src/lib/compras.ts`. É o fecho do sistema: a venda volta para a Meta
carregando a identidade do visitante — `fbp`, `fbc` e os hashes — que
nenhum gateway conhece.

- **Só `aprovada` dispara.** Pendente ainda pode não acontecer; mandar antes
  da hora ensina a Meta a otimizar para quem gera boleto e não paga.
- **`sent_at` é o "já mandei?".** O gateway reenvia o mesmo evento e a
  Appmax ainda tem retry próprio — sem essa trava, uma venda viraria três
  conversões. É marcado **mesmo com falha num destino**: reenviar sozinho
  duplicaria: a falha fica no log, para reenvio manual e deliberado.
- **O `event_id` é derivado do `transaction_id`**, portanto estável. Reenvio
  gera o mesmo id e a Meta deduplica.
- **O casamento roda ANTES do disparo, em série.** É ele que copia `fbp`,
  `fbc` e `ga_client_id` do visitante para a linha da compra. Disparar antes
  mandaria a conversão sem identificação — a Meta aceitaria, e o match seria
  quase zero.
- **Sem `ga_client_id` o GA4 não recebe nada**, e o motivo fica gravado.
  Inventar um faria a compra abrir sessão nova e aparecer como tráfego
  direto, desligada do anúncio que a trouxe.

### O estorno: o GA4 dá, a Meta NÃO dá

**GA4:** existe o evento padrão `refund`, com o mesmo `transaction_id`. Ele
subtrai a receita sozinho.

**Meta: não existe reversão.** A Conversions API não tem "anti-Purchase". A
conversão já contada continua contada, e a única saída é a Deletion API, que
apaga por intervalo de tempo — um machado onde se precisa de bisturi.

**Consequência que o painel precisa dizer:** o ROAS que VALE é o nosso,
calculado sobre `status = 'aprovada'`. O da Meta fica otimista por desenho
dela, não por descuido nosso. Quando os dois divergirem, o certo é o nosso.

**Estorno parcial: `value` é da venda, `reverted_value` é da devolução.**
Nenhum dos cinco gateways documenta se o valor que manda no evento de
reversão é o total original ou só o pedaço devolvido — e as duas leituras
erram de formas opostas, as duas caladas:

| se o gateway manda | e a gente tratasse como | resultado |
|---|---|---|
| o pedaço (R$ 20) | valor da venda | a venda de R$ 200 passa a valer R$ 20 no faturamento |
| o total (R$ 200) | valor devolvido | um estorno de R$ 20 subtrai R$ 200 no GA4 |

A saída **não passa por descobrir qual é**: são colunas separadas. Evento de
reversão nunca toca `value`; o `refund` do GA4 usa `reverted_value ?? value`,
caindo para o total quando o gateway não informa nada — a única suposição
disponível, e a certa para o estorno total, que é o caso comum. Funciona sem
saber o que cada gateway faz, o que é o ponto.

`reverted_at` é o par de `sent_at`: um responde "já mandei a venda?", o outro
"já desfiz?". Sem ele, cada reenvio do evento de estorno — e a Appmax reenvia
até quatro vezes — mandaria outro `refund` e a receita ficaria negativa em
cima de uma venda só.

Disparar e desfazer se excluem **por dentro**: cada um checa o status e sai
calado quando não é o seu caso. A rota chama os dois, porque a ordem dos
eventos do gateway não é garantida e o estorno pode chegar antes da aprovação.

### O geo da compra vem do VISITANTE, nunca da requisição

A requisição do webhook vem do **servidor do gateway**. Usar o IP dela
marcaria toda venda com o datacenter da Appmax — e mandaria esse IP para a
Conversions API, onde ele só atrapalha o match.

O `ip` da compra é o do comprador **quando o gateway manda** (só a Adoorei e
a Pagou mandam); o geo vem do visitante, copiado no casamento.

### Nada que chega se perde

Todo webhook é gravado em `webhooks_recebidos` **antes** de qualquer
interpretação — reconhecido ou não, JSON válido ou não. Antes disso, um
checkout sem adaptador levava 202 e o payload era descartado: a venda sumia
sem deixar rastro.

É também como se escreve adaptador direito: o payload real aparece no
painel, e o adaptador é escrito contra ele, não contra documentação. Os
cabeçalhos vão junto — é neles que se descobre como o gateway assina.

O acerto é por **regex de 32 hexadecimais**, não por igualdade: o checkout pode
devolver o valor embrulhado em texto. E o exemplo da Appmax traz
`client_key: "merchant-key-123"` — chave do lojista, não da visita. Aceitar
qualquer texto ali ligaria **todas** as vendas ao mesmo fantasma.

**Reconhecer e não saber ler é PIOR que não reconhecer, e o painel precisa
distinguir os dois.** Até existir `Indeciso`, "ignorei de propósito" (nota
fiscal, cliente criado) e "reconheci e faltou cadastro" ficavam iguais na
tela: badge verde com o nome do adaptador. O primeiro é normal e é a maioria;
o segundo é **venda possivelmente perdida escondida atrás da aparência de
tratada**.

Agora são três estados, e `webhooks_recebidos.motivo` é o que os separa:

| badge | o que é | o que fazer |
|---|---|---|
| verde | tratado, ou ignorado de propósito | nada |
| amarelo | ninguém reconheceu o formato | falta adaptador — me manda o payload |
| **vermelho** | reconhecido, e não soube ler | o motivo diz o que cadastrar; depois, Reprocessar |

O adaptador nunca chuta nessa situação, e nunca devolve `null`: chutar um
status mandaria conversão errada para a Meta, e `null` esconderia o caso.
Devolve `Indeciso` com o motivo, e a rota responde **200** — o retry do
gateway falharia as quatro vezes igual, porque o que falta é cadastro nosso,
não sorte na rede.

**E guardar só vale se der para reprocessar.** O botão na tela de eventos roda
o payload guardado pelos adaptadores de novo — é o que recupera a venda que
chegou antes do adaptador existir, porque o gateway não reenvia para sempre (a
Appmax desiste depois de quatro tentativas, em definitivo e sem avisar).

O caminho do reprocessamento é o **mesmo** do webhook de verdade:
`src/lib/webhooks/processar.ts` tem `gravarCompra()` e `concluirCompra()`, e
tanto a rota quanto a Server Action chamam aquelas duas funções. Duplicar o
caminho seria garantir que um dia divergem — e a venda reprocessada iria para
a Meta diferente da que chegou sozinha, sem ninguém notar. Reprocessar duas
vezes é inócuo: `dispararCompra()` olha o `sent_at` antes de tudo e sai calado.

A divisão em duas funções tem motivo: `gravarCompra()` roda **dentro** da
requisição, porque falhar ali tem de virar 500 para o gateway reenviar;
`concluirCompra()` roda depois da resposta. Na Server Action as duas rodam em
série mesmo — ali quem espera é uma pessoa que clicou para saber se funcionou,
não um gateway com cinco segundos de paciência.

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
- [x] **Fase 5** — Webhook de compra (Appmax · Pagou · Yampi · Adoorei · Zedy)
- [ ] **Fase 6** — Dashboard (visão geral pronta; faltam eventos, faturamento e geo)
- [ ] **Fase 7** — Campanhas (Meta Ads Insights + ROAS)
- [ ] **Fase 8** — Retenção, auditoria e publicação

Cada fase termina em commit e espera aprovação antes da seguinte.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
