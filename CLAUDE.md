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

         ┌─ CHECKOUT ───────────────────────┐   ┌─ GATEWAY ───────────┐
o funil: │ Yampi · Pagou · Adoorei · Zedy   │ → │ AppMax · MillionsPay │
         └──────────────────────────────────┘   └──────────────────────┘
           dono da página de pagamento            processa o dinheiro
```

> **A Pagou está do lado do CHECKOUT, e já esteve do lado errado aqui.**
> O diagrama a listava como gateway, e isso importa: a classificação decide
> em qual camada o webhook é configurado. Duas coisas do código concordam
> com a correção — ela tem `informations[]`, que é saco de atribuição e é
> coisa de quem é dono da página, e o adaptador lê `correlation_id`. Uma
> discorda: o webhook publicado dela é MÍNIMO, sem comprador, sem valor e
> sem produtos, que é cara de processador. O adaptador já trata os dois
> casos, então a dúvida não muda código — muda para onde apontar o webhook.
>
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
> Yampi, de propósito.
>
> **E a Pagou é as DUAS camadas**, o que torna o cuidado mais fino: ali as
> duas pontas são da mesma empresa, e configurar "uma só" quer dizer uma
> configuração dentro do painel dela, não uma por fornecedor. `acharDuplicataDeOutraCamada` em
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
> do Cloudflare e os cabeçalhos `x-vercel-ip-*` deixam de valer. O recomendado
> é **DNS only** (nuvem cinza) nesse registro.
>
> **E a ORDEM de leitura não é a mesma nas duas configurações — este arquivo
> se contradizia.** `extrairIp` já lia `cf-connecting-ip` PRIMEIRO, certo:
> com o proxy ligado ele é o visitante e o `x-forwarded-for` é a borda do
> Cloudflare. O geo fazia o contrário (`x-vercel-ip-* ?? cf-*`), e com o
> proxy ligado os DOIS conjuntos chegam — então o `??` nunca caía para o
> segundo e a Vercel respondia sobre um datacenter. **Observado em produção:
> IP certo e geo dizendo "The Dalles, Oregon" para quem estava em Minas
> Gerais.** O teste antigo cobria só "a Vercel não mandou nada"; o caso em
> que os dois chegam, que é o que acontece de verdade, nunca foi exercitado.
>
> Agora, com `cf-connecting-ip` presente, o Cloudflare ganha **e não há
> reserva**: os cabeçalhos da Vercel estão errados por construção, não em
> segundo lugar. Como o Cloudflare só manda o país por padrão (região e
> cidade exigem ligar o managed transform *Add visitor location headers*), o
> visitante chega com país e sem o resto — que vira "Não informado" na
> árvore. É honesto; um datacenter americano no lugar da cidade de quem
> comprou não é.

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
- **O corpo do funil cobre os QUATRO degraus, e a largura de cada etapa vale
  no MEIO da faixa dela.** Cada faixa ia da largura da sua etapa até a da
  seguinte, e com a última em zero a forma fechava num ponto no TOPO da
  última faixa: o corpo ocupava três quartos da altura ao lado de quatro
  rótulos, e lia como "o funil só tem três etapas" — foi essa a queixa.
  Agora as bordas são a média com a vizinha (`faixasDoFunil`), a forma cobre
  a altura inteira, e com a última etapa em zero ela fecha num ponto NO FIM,
  que é o desenho de "ninguém passou" em vez de um desenho que some.
- **No desenho do funil, ZERO não ganha corpo.** O piso de largura existe
  para uma etapa PEQUENA não sumir, e estava sendo aplicado ao zero também:
  numa conta com 6 visitantes e nenhuma compra, "Comprou 0" ganhava 9% de
  largura e virava barra sólida — compra fantasma desenhada. É a regra do
  travessão quebrada por outra porta: ela cuidava do número, e a forma
  continuava afirmando quantidade. São três estados (`largurasDoFunil` em
  `funil.ts`, com teste): medida > 0 com piso, medida ZERO com largura zero,
  e sem medida interpolando entre os vizinhos — linearmente ao longo do
  trecho, porque com carrinho E checkout sem medida juntos a média dos
  extremos dava a mesma largura aos dois e o meio virava um bloco reto.
- **O funil tem QUATRO etapas, e a tela busca por `id` — nunca por índice.**
  Visitou → Adicionou ao carrinho → Chegou no checkout → Comprou. Ele nasceu
  com três e o carrinho entrou no meio: quem lesse `etapas[1]` para "chegou no
  checkout" passaria a ler o CARRINHO **sem erro nenhum aparecer** — o número
  só ficaria maior, e ninguém conferiria porque nada quebrou. `etapaDe(funil,
  'checkout')` é o acesso; `funil.test.ts` prova que `etapas[1]` é o carrinho.
  Quando dois nomes alimentam a mesma etapa (o pixel manda `AddToCart`, a gtag
  manda `add_to_cart`), vale o MAIOR e não a soma: somar contaria a mesma
  pessoa duas vezes e o meio ficaria maior que o topo.
- **Mobile-first.** Alvos de toque ≥ 44px (o `size="default"` do Button já dá
  `h-11` no celular). Sidebar no desktop, barra inferior no celular —
  `src/lib/nav.ts` é a fonte única das duas.
- Métrica sem dado mostra **`—`, nunca `0`**: zero é um número, "sem dado" não é.
  É o que o `MetricCard` faz quando recebe `value={null}` — e o que a etapa
  `desconhecido` do funil faz quando o evento que a alimenta nunca chegou.
  **Foi a captura de tela que pegou essa**: o funil mostrava `0,0%` logo acima
  de um aviso dizendo "não porque ninguém passou por lá". O número contradizia
  o texto.
- **O custo por evento tem TRÊS caminhos para `—`, e nenhum é zero.** Gasto
  ÷ visitantes, ÷ checkouts, ÷ compras, no rodapé dos três cartões do topo.
  Sem conta de anúncio o gasto é *desconhecido*; com quantidade zero a
  divisão não existe; etapa `desconhecido` do funil conta como zero, porque
  dividir por um número que não existe inventaria um custo. Mas gasto zero
  **com** conta cadastrada é medida real — R$ 0,00 por visitante é verdade,
  e o teste é `total === null`, nunca `total <= 0`. Escritos com pressa os
  dois somem na mesma condição, e aí a tela passa a esconder número certo.
- **Todo número da tela passa por `formato.ts` — inclusive o ROAS.** Ele
  saía por `toFixed(2)` direto e virava `3.59×` ao lado de `R$ 3.475,90`.
  Em pt-BR o ponto é separador de MILHAR, então o olho lê "três mil" antes
  de corrigir. `multiplo()` resolve, e foi a captura de tela que pegou: o
  cálculo estava certo e ninguém tinha olhado o separador.
- **No ROAS a mesma regra custa dinheiro, e o caso tem nome.** `0.00×` é
  *medida* (gastou e não vendeu); "não casou" é *ausência de medida* (vendeu, e
  a `utm_campaign` não bateu). O que separa os dois é o número da própria Meta:
  se ela contou compra e nós casamos nenhuma, a venda existe e o vínculo é que
  falhou → `—` com o diagnóstico, nunca `0.00×`. `motivoSemRoas` em
  `src/lib/painel/roas.ts` carrega essa distinção até a tela. Sem ela, quanto
  MAIOR o gasto mais vermelho fica — e a primeira campanha a ser cortada seria
  a que mais vende. O mesmo vale para a conta inteira: se nenhuma receita do
  período casou com campanha nenhuma, quem está caída é a ponte da UTM, e a
  tela toda vermelha diria isso de cada campanha em vez de dizer uma vez.
- **Número na tela nunca passa por `Intl.NumberFormat`.** Ele depende do ICU, e
  o do Node não é o do navegador: em moeda pt-BR a diferença é o tipo de espaço
  depois do "R$" — o texto parece igual, o React vê diferente, e a hidratação
  quebra. `src/lib/formato.ts` formata à mão, com vetores em `formato.test.ts`.
  É a mesma armadilha do `toLocaleString` em data, por outra porta, e pior:
  o erro depende de qual navegador abriu a página.

### O filtro de período: um menu, não uma fileira de atalhos

Sete opções — Hoje · Ontem · 7 dias · 30 dias · Este mês · Mês passado ·
Máximo — mais a faixa livre, tudo dentro de **um controle só**, igual no
desktop e no celular.

> **Era uma fileira de chips, e no celular ficava caro.** Cinco chips numa
> linha que rolava na horizontal, mais dois campos de data e um botão: TRÊS
> linhas no topo da tela mais importante, antes de qualquer número,
> empurrando as métricas para fora da primeira dobra. A queixa foi direta —
> *"achei meio feio no telefone"*. E a fileira que rola ainda escondia
> opção: "Este mês" só aparecia arrastando, e ninguém arrasta o que não sabe
> que existe.

- **`<details>`, não um dropdown em React.** O navegador abre e fecha
  sozinho, com semântica de botão e estado expandido para o leitor de tela, e
  sem uma linha de JS. As opções são `<Link>` porque o período vive na URL
  (`?periodo=…` ou `?de=…&ate=…`): o estado é compartilhável, sobrevive ao
  recarregar e funciona antes da hidratação. Um `<select>` com `onChange`
  custaria JS para reimplementar o que o navegador já faz.
- **O painel abre POR CIMA do conteúdo**, com `.flutuante` e não `.glass`:
  vidro translúcido deixaria o texto de trás aparecer através dos campos de
  data. É a regra que o seletor de moeda aprendeu primeiro.
- **A faixa fica na MESMA lista, não atrás de escolher "Personalizado".** Na
  referência que inspirou o desenho é preciso selecionar a opção para só
  então ver os campos; aqui eles já estão no pé, a um toque em vez de dois.
- **A faixa é INCLUSIVA nas duas pontas**, e a conversão para o `ate`
  exclusivo do painel acontece em `intervaloDe`. Guardar já convertido faria
  a tela devolver "1 a 16" para quem pediu "1 a 15".
- **`paramsDaEscolha` é fonte única** para os quatro lugares que remontam a
  query — menu, paginação de Eventos, filtro de tipo e seletor de conta.
  Cada um montando o seu seria garantir que um dia a faixa deixa de
  atravessar de um deles, calado. O formulário de filtro da aba de Eventos
  era esse caso: tinha `name="periodo"` cravado num campo escondido, e
  filtrar por tipo de evento DESFAZIA a faixa escolhida.
- **Teto de 366 dias.** A Meta recusa `time_range` além de 37 meses, e o "vs
  período anterior" de uma faixa de cinco anos compara com anos que talvez
  não existam. Fora disso cai no padrão, como qualquer lixo de query string.
- **Os campos de data nascem com HOJE, não vazios.** Campo vazio não diz qual
  período está na tela. `hojeEm` calcula no fuso do painel — em UTC, às 21h
  em São Paulo o campo mostraria o dia seguinte ao que o menu está contando.
- **"Mês passado" termina no dia 1º DESTE mês**, não no último dia do
  anterior: o `ate` é exclusivo, e pedir o dia 1º devolve a mesma fronteira
  sem ninguém precisar saber quantos dias o mês teve. Com o mês em base 1,
  `mes - 1` dá 0 em janeiro e o `Date.UTC` já trata isso como dezembro do ano
  anterior — um `if (mes === 1)` escrito à mão é que teria chance de errar o
  ano. Há teste para janeiro e para fevereiro bissexto.
- **"Máximo" para em 36 meses, e o limite é DA META.** A nossa receita sai
  do nosso banco e não tem teto; o gasto sai do `time_range` da Meta, que ela
  recusa além de 37 meses. Uma janela maior devolveria a tela com receita
  completa e gasto faltando — e o ROAS dividindo um pelo outro estaria
  errado, calado, que é o que este painel existe para não fazer. Então
  "Máximo" é a janela mais longa em que TODOS os números são verdade juntos;
  numa loja com menos de três anos é literalmente tudo que existe. Se um dia
  passar disso, o certo não é esticar o período: é a tela dizer que o gasto
  não cobre a janela inteira.
  Começa no dia 1º do mês, não "36 meses atrás, hoje", para a fronteira não
  andar sozinha todo dia e o número não mudar sem nada ter acontecido.
- **LARGURA DE `input type="date"` NÃO SE SUPÕE — quem escolhe o formato é o
  NAVEGADOR.** Isto errou duas vezes, e a segunda só apareceu num aparelho de
  verdade: o Chromium headless em que eu testo mostra `09/28/2026` e o
  **Safari em pt-BR mostra `29 de set. de 2026`**, mais que o dobro. Lado a
  lado, o segundo campo saía cortado pela borda do cartão no iPhone. São um
  por linha, com rótulo em cima, e a prévia tem um bloco que **imita o pior
  caso** mais uma medição de `scrollWidth > clientWidth` a 390px e a 320px —
  é o que prova a linha sem depender de eu ter o aparelho.

### Atualizar é `router.refresh()`, não `location.reload()`

O botão de atualizar fica na **topbar**, não em cada aba: o painel inteiro é
`force-dynamic` e "está atualizado?" é a mesma pergunta em todas elas. Um
botão por tela seria o mesmo código cinco vezes, e o dia em que uma aba nova
esquecesse de copiar ninguém notaria — o mesmo modo de falha do
`loading.tsx`.

`router.refresh()` refaz só os Server Components. O `reload` joga fora o
bundle, as fontes e o CSS, e **perde o que está aberto na tela**: a gaveta do
visitante fecha, a árvore de geo volta ao estado fechado, o scroll vai para o
topo. Quem está conferindo um visitante e clica em atualizar perde
exatamente o lugar onde estava olhando.

O ícone gira enquanto a transição está pendente. Sem isso, num painel que
responde rápido o clique não produz nada visível e a pessoa clica de novo
achando que não funcionou.

### Navegação entre abas: `loading.tsx` não é enfeite

Toda aba do painel é `force-dynamic`. **Sem um `loading.tsx`, a navegação não
troca a tela**: ela abre a requisição e espera o servidor terminar todas as
consultas com a aba ANTIGA ainda desenhada — congelada, sem spinner e sem
reação. O clique parece não ter funcionado, e a queixa que chega é "o painel
está lento" quando o banco respondeu no mesmo tempo de sempre.

Medido numa rota de teste com 1500ms de atraso, no build de produção, com o
Playwright cronometrando o clique:

| | a tela troca em |
|---|---|
| sem `loading.tsx` | **1892 ms** |
| com `loading.tsx` | **126 ms** |

O dado real chega em ~1900ms nos dois. O que muda é o primeiro frame.

Consequências práticas:

- **Aba nova nasce com o `loading.tsx` dela**, e agora há teste
  (`(dash)/loading.test.ts`). É o modo de falha clássico — o mesmo do
  `prepararCaptura()`: quem escreve a aba nova esquece de copiar a trava, e
  ninguém percebe porque nada quebra. Pior que "sem esqueleto": a rota
  **herda** o do `(dash)`, então `/estilo` mostrava seis métricas, funil e
  geo antes de virar uma página de paleta. Regra escrita e não verificada é
  regra que já foi quebrada — esta estava, por `/estilo`.
- **O esqueleto tem a MESMA geometria da tela real.** Contagem de cartões,
  colunas da grade, altura do gráfico. Esqueleto de outro tamanho é pior que
  nenhum: o conteúdo salta quando chega e o olho perde o lugar. Os blocos
  estão em `src/components/dash/esqueletos.tsx`, e a foto é que decide se
  batem — o teste não pega geometria.
- **A cor do esqueleto é `--foreground` a 10%, não `--muted`.** No escuro o
  `--muted` (13%) fica a um ou dois pontos do cartão de vidro (~9%) e o
  esqueleto SOME: a tela carregando lia como tela vazia. Sobre a cor do texto
  o valor se ajusta sozinho nos dois temas.
- **O que vai à Meta fica em `Suspense`, sempre.** O gasto da visão geral e
  a árvore de campanhas saem da API da Meta, que é a coisa mais lenta do
  painel (fila serial, cache de 15 min). Dentro do `Promise.all` prendiam a
  tela inteira — as contagens do nosso banco já estavam prontas e ninguém as
  via. Quando o mesmo dado serve a vários boundaries, `cache()` do React
  dedupe: sem ele, três cartões seriam três idas à Meta na mesma tela. A
  memoização é por **identidade** do argumento, então todos recebem o MESMO
  objeto `intervalo`.
- **Lista longa passa `limite` à `ListaRanqueada`, nunca `slice` antes
  dela.** Cortar antes entrega uma lista já curta e o "+ N outros, somando
  X" do componente nunca aparece — e ele existe para a lista não esconder
  linhas em silêncio. Nas cidades isso era a maior parte do dado.
- **Campo pesado não viaja numa listagem.** `events_log` já seguia isso com
  `buscarPayload`; a lista de webhooks tinha ficado de fora e mandava os 50
  `corpo` jsonb — o pedido inteiro de cada gateway, com cliente e endereço —
  no payload do RSC **com todas as linhas fechadas**. Agora quem abre a
  linha busca a dela por Server Action. A regra: se o campo só aparece
  quando alguém expande, ele não entra no `select` da lista.

### A origem é uma cascata, porque a UTM do evento é a exceção

As UTMs são lidas da URL de **cada** evento. A pessoa cai em
`/?utm_campaign=X` e só esse PageView as carrega; no clique seguinte ela
está em `/products/camiseta`, sem query string, e o AddToCart, o
InitiateCheckout e o Purchase nascem sem UTM nenhuma.

Ou seja: a MAIORIA das linhas da tabela de Eventos dizia "sem campanha na
UTM", o que lia como falha de marcação quando era navegação normal. O dado
existe — está no VISITANTE, gravado no `/api/identify` da primeira visita.

`resolverOrigem()` em `src/lib/painel/origem.ts` responde em quatro níveis:

| nível | o que é |
|---|---|
| `evento` | a UTM na URL deste evento — o mais preciso |
| `visitante` | a UTM da primeira visita desta pessoa |
| `referrer` | o site anterior, quando não houve UTM nenhuma |
| `direto` | endereço digitado, app, ou o navegador cortou |

**O nível volta junto e aparece na tela**, porque "esta compra carregava a
campanha" e "esta compra é de alguém que um dia chegou pela campanha" são
afirmações diferentes, e a segunda é mais fraca. Iguais na tela,
prometeriam uma precisão que o dado não tem.

O referrer é reduzido ao **domínio**: o caminho de uma URL de busca leva o
termo que a pessoa digitou, e isso é dado dela que não tem por que ficar
numa tabela do painel. Referrer que não parseia volta cru — um "direto" que
mente é pior que um texto estranho.

O visitante de cada linha vem numa consulta só, com `in` sobre a coluna
indexada: é 1+1, não N+1.

### A cor dos blocos de Configuração é informação

Verde = pixel da Meta · laranja = GA4 · azul = conta de anúncio. Tokens da
marca (`--success`, `--amber`, `--primary`), não `--chart-*`: a série de
gráfico é escolhida para separar **entre si num gráfico**, e os três
estavam em matizes vizinhos demais para identificar de relance.

Não é enfeite. As três seções guardam credenciais de serviços diferentes
com campos que se parecem, e colar o `api_secret` do GA4 no campo do token
do pixel **não dá mensagem nenhuma**: o "Testar conexão" falha com um texto
do lado de lá e o caminho até entender é longo. A cor responde antes de a
pessoa colar.

Faixa grossa + borda + cabeçalho tingido + título colorido — e o tingimento
**para no cabeçalho**: as linhas de conta ficam neutras porque é nelas que
se lê id e token, e fundo colorido atrás de texto pequeno custa
legibilidade sem ganhar identificação.

**Instalação é a primeira aba e a padrão.** O script já existia lá, com
campo de copiar; só estava atrás de "Geral", e a pergunta que chegou foi
"onde no painel eu acho o script para colar no tema?".

### Geo é ÁRVORE, não mapa — e não é preguiça

Um mapa colorido mostra **concentração** e nada mais. Comparar dois tons de
azul é o pior jeito de comparar dois números, e a skill de `dataviz` lista
coroplética acima de três séries como anti-padrão. Isso não mudou.

O que mudou é a forma. Eram **três listas soltas** — receita por região,
visitantes por região, cidades — e elas respondiam "quem são os maiores" em
cada grão sem responder a pergunta que decide frete, prazo e corte de
campanha: **de onde veio a conversão**. Ver "SP" numa lista e "Campinas" na
outra não diz se Campinas está dentro daquele SP nem quanto pesa nele.

Agora é **País > Estado > Cidade**, fechada por padrão, como a árvore de
campanhas. Cada nível traz receita, visitantes, vendas e conversão, com
**duas barras empilhadas**: verde de receita, azul de visitantes. A
comparação entre elas é o dado — azul comprida com verde curta é tráfego que
não converte, e agora isso salta sem procurar o mesmo nome em duas colunas.

> **Uma consulta só, no grão mais fino — e os níveis somam a partir dela.**
> `painel_cidades` exigia `geo_city is not null`, e a Vercel manda país
> sempre e cidade nem sempre. Somando as cidades de um estado para conferir
> com o estado, faltava gente, e nada na tela diria por quê. Numa árvore, em
> que abrir o nó é justamente conferir a soma, discordar é o pior defeito
> possível. `painel_geo_arvore` devolve o grão fino com região e cidade
> **nulas preservadas**, e `montarArvoreGeo` soma para cima — fecha por
> construção, não por coincidência. Quem não tem cidade aparece como
> **"Não informado"**, que é diferente de sumir.
>
> `painel_geo` e `painel_cidades` foram **apagadas**, não deixadas de lado:
> `painel_cidades` é o caminho pronto e óbvio para quem for escrever a
> próxima tela de cidades, e traz o furo embutido. Deixá-la de pé é deixar a
> armadilha de pé.

**Barra tem três estados, como o funil.** Zero não desenha nada; um valor
pequeno desenha um toco de **3px**; o resto é proporcional. Sem o piso, seis
visitantes entre quatro mil viravam meio pixel, que lê como sujeira de
renderização e não como valor. Com piso no zero também, uma região sem venda
ganharia corpo — a compra fantasma do funil por outra porta. O piso é em
**pixel**, não em porcentagem: 1,5% de uma barra de 900px são 13px, largura
que já afirma quantidade.

**Nó com um filho só que repete o pai não abre.** Um país com um estado só,
um estado com uma cidade só: abrir para ver o mesmo número ensina que abrir
não vale a pena, e aí ninguém abre o nó que tem ramo.

Se o mapa entrar um dia, entra **ao lado** da árvore, nunca no lugar dela.

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

**Cor por tipo de evento fica na TABELA, não na lista ranqueada.** A
tentativa de pintar a lista por tipo foi desfeita depois de ver na tela:
cada barra já tem o nome colado nela, então o matiz não identificava nada
que o rótulo não identificasse — e cinco barras de largura cheia em cinco
matizes viram parede de cor. Na tabela de Eventos ela vale, porque ali as
linhas vêm misturadas e a marca é um ponto de 10px.

**E a rampa sequencial, que seria o certo para uma sequência, não cabe.**
PageView → AddToCart → InitiateCheckout → Purchase é a mesma pessoa
avançando, e sequência pede escala de uma cor, não paleta categórica. Mas o
validador da `dataviz` mostra que a banda de luminosidade sobre `#070a12` é
estreita demais para quatro passos: espremendo, o primeiro cai abaixo de
3:1 de contraste e **lê como cinza**. O número decidiu, não o gosto.

**Funil e lista ranqueada usam UMA cor.** As etapas não são identidades
diferentes — são a mesma quantidade encolhendo, e quem carrega a magnitude é o
comprimento da barra. Matiz por etapa gastaria três cores para não dizer nada.
Série única também não pede legenda: o rótulo já está na barra.

> **Neste ambiente a foto tem de ser do BUILD, não do `next dev`.** O
> websocket de HMR não atravessa o proxy de saída, e sem ele a hidratação não
> completa: o componente aparece certo e **não responde a clique**. Passei um
> tempo achando que o `onClick` estava errado. Para conferir qualquer coisa
> interativa: `npm run build && npx next start -p 3100`.

**Função não atravessa a fronteira servidor→cliente.** Passar
`formatar={moeda}` de um Server Component para um gráfico dá *"Functions
cannot be passed directly to Client Components"* — e não é erro de build só:
a serialização do RSC não tem como mandar código. O nome do formato viaja
(`formato="moeda"`), o componente escolhe. Quem pegou foi o **build da rota
de prévia**, que é estática; a tela real é `force-dynamic` e teria estourado
em produção.

**O passo 7 da skill é literal: renderize e olhe.** O validador checa cor, não
layout. Sem credenciais do Supabase dá para montar uma rota `previa` temporária
com dados falsos, liberar o caminho em `ROTAS_PUBLICAS`, tirar a foto com o
Playwright nos dois temas e em 390px, e apagar tudo depois. Quatro problemas
saíram dessas fotos e nenhum teste os pegaria: o `0,0%` acima, uma seta `↓` ao
lado de `10,6%` que lia como "caiu 10,6%" quando o número era o que PASSOU (a
seta virou `↳` e o texto virou "seguiram"), `R$ 37.158,70` partindo em duas
linhas no celular com o "R$" sozinho parecendo outro número, e o `0.00×`
vermelho numa campanha que a Meta dizia ter 2 compras — a venda existia, a UTM
é que tinha um erro de digitação.

A do gráfico de série pegou mais dois: os rótulos do eixo ficavam **por cima
do dado** do começo do período (ganharam calha própria, num flex), e o SVG
posicionado por `left`/`right` **não ganhava largura calculada** — caía no
tamanho intrínseco do `viewBox`, 600px, e no celular atravessava a tela
inteira. Calha e quadro viraram irmãos num flex, e todo `%` passou a ser
relativo só ao quadro.

E o teto do eixo tem degraus finos (`[1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]`)
porque com os grossos um pico de 5.120 subia para 10.000 e a curva ficava
espremida na metade de baixo, **parecendo plana num período que dobrou**. O
eixo sempre começa em zero: cortar a base é a forma mais fácil de mentir com
um gráfico, e num painel de faturamento vira decisão de mídia tomada em cima
de uma ilusão. `serie.test.ts` trava as duas coisas.

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
- **Para a gtag mudam o NOME e o FORMATO — trocar só o nome é conserto
  nenhum.** O funil de comércio eletrônico do GA4 tem nomes próprios
  (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`) **e** se
  alimenta de `items[]`. Mandar `AddToCart` com `content_ids` erra os dois;
  mandar `add_to_cart` com `content_ids` erra um e falha igualzinho — o
  evento entra na lista e a tela de Monetização fica em branco, porque
  `content_ids` é vocabulário da Meta e o GA4 descarta. `NOME_GA4` traduz o
  nome e `corpoGa4()` traduz o corpo; o vocabulário da Meta segue intacto
  para o `fbq` e o `events_log`. O servidor já fazia certo (ver `items` em
  `compras.ts`) — era o navegador que estava fora do padrão.
  A busca no mapa é `hasOwnProperty`, nunca `NOME_GA4[nome] ||`: o nome vem
  de quem chama `rrtrack.track()`, e `track('constructor')` acharia a função
  herdada do protótipo e a mandaria como nome do evento.
- **`ViewContent` usa a variante DA PÁGINA, não `variants[0]`.** Numa
  camiseta P/M/G por 89,90 / 109,90 / 129,90, a primeira da lista manda
  sempre o mais barato: a otimização por valor da Meta aprende com esse
  número e a coluna de valor do Events Manager deixa de bater com a página.
  A escolhida vem de `?variant=` ou de `selectedVariantId`. E o preço passa
  por `typeof === 'number'`, não por `if (p.value)` — brinde vale R$ 0,00, e
  o teste falsy jogava o campo fora em vez de mandar zero.
- **`ViewContent` dispara em página de produto, e só nela.** É o degrau entre
  ver e pôr no carrinho, e a Meta otimiza com ele. Detectar demais é pior que
  de menos: um `ViewContent` em toda página ensinaria a Meta que a home é
  produto, e o público de remarketing viraria "todo mundo". O teste é no
  CAMINHO (`/products/<handle>`, inclusive dentro de `/collections/`), nunca
  no href — e sem regex, pela armadilha da barra escapada. Sai **mesmo sem**
  o tema expor `ShopifyAnalytics`: evento sem `content_ids` ainda ensina a
  Meta quem olhou, e um evento a menos não ensina nada.
- **O `PageView` passa pelo `api.track`, nunca por um `fbq` solto.** Um
  `fbq('track','PageView')` sem `eventID` vai só pelo navegador: sem
  deduplicação, e sem NADA quando um bloqueador mata o pixel — que é o
  problema que este sistema existe para resolver. Pelo `track` ele sai pelos
  dois caminhos com o mesmo id, e de quebra entra no `events_log`, que é o
  que alimenta a aba de Páginas. O GA4 fica de fora (`ga4: false`): a gtag já
  manda `page_view` no config, e um evento a mais com outro nome mediria a
  mesma coisa duas vezes.
- **E ele dispara DEPOIS do `/api/identify`.** Numa visita nova o `_trck`
  ainda não existe — quem o cria é a resposta. Disparar antes gravaria o
  evento sem `trck_user_id`, e como a maioria do tráfego de uma loja é visita
  nova, a maioria dos PageView nasceria órfã.
- **O snippet é gerado dentro de um template literal, e isso morde duas
  vezes.** Backtick em comentário FECHA a string — essa o build pega. Pior:
  barra escapada numa regex vira barra simples no JavaScript emitido, então
  `/\/cart/` sai como `//cart`, que é **comentário** — o build passa, o
  snippet sobe, e a detecção some em silêncio na loja do cliente. Por isso a
  detecção do carrinho não usa regex, e `snippet-carrinho.test.ts` compila o
  que foi gerado antes de executá-lo.
- **`/t.js` não tem allowlist** — tag de script não manda `Origin`, e o arquivo
  só contém ids de GA4 e de pixel, que qualquer visitante já enxerga. Token
  nenhum passa por ali.
- **O clique do anúncio é o dado que MENOS perdoa, e são TRÊS parâmetros.**
  Cada um chega uma vez na URL da visita e nem a Shopify, nem o checkout,
  nem o gateway o conhece depois — não lido na hora, não volta.

  | na URL | vira | por quê |
  |---|---|---|
  | `fbclid` | `fbc` montado | a Meta quer `fb.1.<ts>.<fbclid>` |
  | `gclid` | `gclid` CRU | o `ClickConversion` do Google Ads o quer cru |
  | `wbraid` | `wbraid` CRU | é o que chega quando o consentimento limita o `gclid` |

  O `gbraid` fica de fora de propósito: o proto do SDK oficial o descreve
  como *"clicks associated with APP conversions"*, e esta loja não tem
  aplicativo. Coluna que nunca recebe valor é pior que ausente — sugere que
  alguém já pensou no caso.

  **A volta sem clique não pode apagar o clique que trouxe a pessoa.** O
  identify roda a cada pageview, e quem chegou por anúncio passa por lá de
  novo sem `gclid` na URL. Quem impede o estrago é o filtro de nulos do
  upsert — a mesma trava do "campo vazio não apaga" do webhook.

  **E a compra CONGELA o clique.** `visitors` guarda um valor só, o da
  última visita: quem volta por outro anúncio reescreve lá o clique que
  gerou a venda anterior. A cópia no casamento é o que impede a importação
  de conversão offline de creditar o anúncio errado — mesma razão de
  `fbp`/`fbc` serem copiados.

> **Teste de snippet espera a fila de microtasks.** O PageView e o
> ViewContent saem no `.then()` do `/api/identify` — a trava que impede o
> evento de nascer órfão. Ler os eventos logo depois do `vm.runInContext`
> pega o array VAZIO, e o teste reprova dizendo que o evento não dispara
> quando ele dispara um tique depois. `montar()` é `async` por isso.

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

**No NAVEGADOR os quatro de identidade vão em CLARO, e o `external_id`
vai HASHEADO.** Não é inconsistência — são regras diferentes do mesmo
documento. A doc de Advanced Matching diz que o Pixel hasheia `em`/`ph`/
`fn`/`ln` sozinho, e diz também que ele **aceita tanto o valor cru quanto o
SHA-256 já normalizado**. Entregar hash nos quatro primeiros faria ele
hashear um hash; entregar hash no `external_id` é o que faz o Pixel e a
Conversions API mandarem o MESMO identificador, que é o que ela pede quando
o id vai por mais de um canal.

**O hash do `external_id` vem PRONTO na resposta do `/api/identify`.** O
servidor o calcula uma vez e usa nos dois destinos — a coluna do visitante e
o corpo da resposta. Calcular no navegador seria hashear em dois lugares, e
o dia em que divergissem a Meta veria duas pessoas sem avisar ninguém. Não
expõe nada: é o hash de um id que o navegador já tem em claro no `_trck`.

**E o Advanced Matching ACUMULA, num objeto só.** O identify chega em dois
momentos — o site passando o e-mail, a resposta trazendo o `external_id` — e
cada um conhece só a sua parte. Reinicializando com o pedaço da vez, o
segundo apaga o primeiro e o Pixel fica sempre com metade do sinal, sem erro
nenhum aparecer.

> **Dois arquivos de teste, porque um só deixou furo.**
> `snippet-match.test.ts` executa o snippet e prova o lado de quem consome —
> mas ele mocka o `fetch`, então tirar o campo da resposta da rota deixava
> os nove testes dele verdes. `api/identify/route.test.ts` fecha o contrato
> do outro lado: que a rota MANDA o campo, que é o hash e não o id cru, e
> que é o mesmo hash que foi para a coluna. Verificado quebrando as duas
> pontas.

---

## Destinos server-side — as regras do envio

O evento sai por dois caminhos: o Pixel no navegador e a Conversions API aqui.
O que impede a conversão de contar em dobro é o `event_id` ser **idêntico** nos
dois — a Meta recebe os dois, vê o mesmo id e fica com o mais completo.

- **A compra manda a identidade INTEIRA que a linha carrega, não parte
  dela.** Por um tempo mandou SETE parâmetros de match contra os ONZE de um
  PageView — no evento que a Meta usa para OTIMIZAR. E não era falta de
  dado: `trck_user_id`, `geo_city`, `geo_region` e `geo_country` já estavam
  gravados na própria linha, copiados do visitante no casamento, e só não
  eram passados ao `montarUserData()`. Nada quebra quando isso acontece — a
  conversão chega, conta, e a nota de match fica baixa sem ninguém saber por
  quê. Ao acrescentar campo à compra, acrescente também ao envio.
- **O `event_time` é a hora da VENDA, e ela vem do gateway.** `occurred_at`
  (o `paid_at`/`created_at`/`time` que os cinco adaptadores extraem) primeiro,
  `created_at` — quando o webhook chegou AQUI — de reserva. No fluxo normal
  diferem por segundos; num retry da Appmax, que são quatro, ou num
  Reprocessar de venda antiga, diferem por dias. **E de propósito não há
  teto:** a Meta recusa evento com mais de 7 dias, e deixá-la recusar é
  melhor que remendar a data — a recusa fica no `response_meta` e alguém vê;
  uma venda antiga datada de hoje entra calada, suja o ROAS do dia e ensina
  o otimizador que houve conversão agora. O GA4 leva a MESMA hora em
  `timestamp_micros`: se cada um pegasse a sua, conferir um relatório contra
  o outro acusaria diferença que não existe.
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

- **O token é aceito em QUATRO lugares**, porque cada gateway escolheu o seu
  e nenhum deixa mudar: `?token=` (Appmax e Pagou, que não mandam header
  nenhum), `Authorization: Bearer` (a Zedy documenta assim),
  **`X-Adoorei-hash`** (a Adoorei — e o nome engana: "hash" é o **TOKEN do
  cadastro**, comparado por igualdade; não há fórmula, algoritmo nem
  assinatura sobre o corpo em lugar nenhum da doc dela) e `x-webhook-token`
  como alternativa genérica. Descobrir o da Adoorei tarde custaria **401 em
  toda venda**. Aceitar todos não enfraquece nada: a comparação é sempre
  contra o mesmo token configurado, em tempo constante.
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

> **O banco de mentira HONRA o `select`, e isso não é capricho.** Antes ele
> devolvia o visitante inteiro qualquer que fosse a lista de colunas — e aí
> o teste mentia do pior jeito: tirar uma coluna do `select` da produção não
> reprovava NADA. A cópia para a compra virava no-op silencioso
> (`data.<coluna>` vinha `undefined`, o filtro de nulos a descartava) e nada
> apontava a falta. Descoberto ao verificar quebrando: removi `gclid,
> wbraid` do select e os 37 testes seguiram verdes. Agora `soAsPedidas`
> reduz o visitante ao que foi pedido, e isso guarda TODAS as colunas
> copiadas — tirar `geo_city`, `fbc` ou `ga_client_id` também reprova.

### Assinatura: quem assina, quem não assina, e quem se contradiz

| gateway | assina? |
|---|---|
| **Yampi** | **sim** — `X-Yampi-Hmac-SHA256`, `base64(HMAC-SHA256(corpo_cru, segredo))`. **Base64, não hex** |
| **MillionsPay** | **sim** — `X-SoarLabz-Signature`, `sha256=<hex>`, sem timestamp |
| **Adoorei** | não. `X-Adoorei-hash` é token do cadastro, apesar do nome |
| **Zedy** | não. `Authorization: Bearer` com token estático |
| **Appmax** | não. A doc diz com todas as letras que não envia |
| **Pagou** | não — e ela **afirma** isso: *"The public contract exposes no signature"* |

> **As duas que assinam se contradizem, e da mesma forma.** O texto manda
> assinar o **corpo cru**; o exemplo de código **re-serializa** — a Yampi com
> `json_encode($body)` em PHP, a MillionsPay com `JSON.stringify(req.body)`
> em Node. `JSON.stringify` de um objeto já parseado muda espaçamento e
> ordem de chaves: o hash não é o mesmo.
>
> Não dá para deduzir qual vale — é contradição da doc, não falta de
> atenção. Resolve-se no primeiro postback real, comparando os dois. É por
> isso que a rota preserva o corpo cru desde o começo: a verificação entra
> depois sem mexer em mais nada.
>
> A Yampi ainda tem uma segunda contradição própria: a nota diz que o base64
> é sobre o HMAC **binário**, e o valor de saída do exemplo dela é base64 de
> uma string **hex**. Texto e exemplo discordam.

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

> **E a Yampi NÃO TEM evento de estorno nem de chargeback.** Confirmado na
> doc em 25/09/2026: as duas listas autoritativas dela (14 eventos na tabela,
> 13 no enum da API) não trazem nenhum. O **único** caminho documentado para
> saber que uma venda voltou é `order.status.updated` + o alias.
>
> Isso torna o cadastro de `status_aliases` **obrigatório** para quem usar a
> Yampi, não opcional. Sem o alias de estorno daquela loja, o `refund` nunca
> chega ao GA4 e o faturamento fica inflado por uma venda devolvida — e não
> há evento nenhum para servir de rede.

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

**A checagem olha CINCO relações, não só `status`** — `pareceYampi()` em
`src/lib/webhooks/envelope-yampi.ts`, num arquivo só para os dois lados não
divergirem. Olhar só `status` tinha furo: a lista real de eventos da Yampi
inclui `cart.reminder`, `customer.*`, `product.*` e `cashback.expiring`, e um
carrinho abandonado pode não ter status nenhum — aí o teste não rejeitava e a
Adoorei reivindicava um payload da Yampi. Não escrevia dado errado (o `cart.`
é ignorado dos dois lados), mas o painel mostrava o adaptador errado, e a
próxima relação que a Yampi acrescentar pioraria isso.

A Yampi reconhece **todos** os seis prefixos dela e ignora o que não é venda:
"reconhecido e ignorado" é verde no painel, "ninguém reconheceu" é amarelo e
pede ação — e pedir ação à toa ensina a ignorar o aviso.

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
e-mail, mesmo valor, **outra linha** (`transaction_id` diferente) e dentro
de meia hora.

> **Era "plataforma diferente", e o proxy quebrou.** A ideia — "camadas
> diferentes do funil" — estava certa; usar `platform` para representá-la,
> não. **A Pagou é checkout E gateway ao mesmo tempo**, então as duas
> linhas nasciam `platform = 'pagou'`, o `neq` as excluía, a duplicata não
> era achada e a venda ia DUAS VEZES para a Meta — calada, e é justamente
> isso que esta função existe para impedir.
>
> O que sempre importou é "outra LINHA da mesma venda", e a identidade da
> linha é o `transaction_id`. Quando as duas camadas reportam o mesmo id, o
> upsert já as funde e nada disto roda.
>
> O preço da troca: quem compra o mesmo valor duas vezes em trinta minutos,
> no mesmo checkout, tem a segunda conversão suprimida. A venda continua
> gravada e continua na receita — perde-se um sinal para a Meta. É o erro
> barato: contar conversão que não houve ensina o otimizador errado **e**
> infla o faturamento.

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

> **A Appmax é o caso em que nem isso salva.** Ela tem evento próprio para
> estorno parcial (`order_partial_refund`) e **não informa o valor
> devolvido** — o único campo é `refund_at`, que é data/hora, e o `total`
> continua sendo o do pedido inteiro.
>
> Tratar como `estornada` mandaria ao GA4 um `refund` do valor **cheio**: um
> estorno de R$ 20 numa venda de R$ 200 faria a venda inteira sumir da
> receita. Errado por R$ 180. Não tratar deixa a receita R$ 20 alta — errado
> por R$ 20, nove vezes menos, e sem fazer uma venda real desaparecer.
>
> Errar calado seria pior que os dois, então o adaptador devolve `Indeciso`:
> a venda fica intacta e a linha aparece em **vermelho** no painel dizendo o
> que houve. O ajuste é deliberado, não automático e errado.

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

### Testar a venda ANTES de ter checkout

`docs/TESTAR-VENDA.md` tem um `curl` por gateway, com o `trck_user_id` no
campo certo de cada um. Existe porque a metade de baixo do sistema — webhook
→ grava → casa → manda para a Meta — só roda quando há checkout ligado, e
descobrir um problema ali durante a primeira venda de verdade é a pior hora
possível.

**Os cinco payloads são LIDOS DO DOCUMENTO e testados a cada `npm run
check`** (`exemplos-do-doc.test.ts`): o adaptador certo reconhece, o
`trck_user_id` atravessa, e o status entra como `pendente`. Lidos, não
copiados — a primeira versão trazia cópias escritas à mão e prometia
"prende o doc ao código" sem prender nada: editar o curl do documento
deixava a suíte verde e o comando publicado passava a devolver 202. Documento com exemplo quebrado é
pior que documento nenhum — quem cola um curl e leva 202 conclui que o
SISTEMA está errado e vai depurar o lugar errado. Escrever esse teste pegou
quatro erros no doc na primeira rodada: alias da Yampi em português (é
configuração da loja, não padrão), `orderId` da Zedy como número (é texto),
`status` da Zedy fora do mapa, e os campos da Adoorei com nome inventado.

O Passo 1 do doc usa status **pendente** de propósito: só `aprovada` dispara
conversão, então ele exercita tudo **sem encostar no pixel**. O Passo 2, que
dispara de verdade, pede o `test_event_code` antes — porque a Conversions API
não tem como desfazer uma conversão já contada.

### Nada que chega se perde

Todo webhook é gravado em `webhooks_recebidos` **antes** de qualquer
interpretação — reconhecido ou não, JSON válido ou não. Antes disso, um
checkout sem adaptador levava 202 e o payload era descartado: a venda sumia
sem deixar rastro.

É também como se escreve adaptador direito: o payload real aparece no
painel, e o adaptador é escrito contra ele, não contra documentação. Os
cabeçalhos vão junto — é neles que se descobre como o gateway assina.

**Menos o token.** Ele chega num cabeçalho — `Authorization: Bearer` na Zedy,
`x-webhook-token` no genérico, `x-adoorei-hash` na Adoorei — e a linha de
auditoria é lida pelo painel e **impressa na tela**. Gravá-lo cru seria segredo
em repouso numa coluna nossa: a mesma armadilha que o `payload_meta` já desvia,
por outra porta, e exatamente o que a escolha do Vault existe para evitar.
`cabecalhosSeguros()` mascara **por valor, não por nome** — a lista de nomes
cresce a cada gateway e esquecer um é silencioso, enquanto comparar contra o
token configurado pega até o nome que um gateway futuro inventar. O **nome** de
todos fica, porque é ele que diagnostica; a assinatura HMAC também, porque é
resumo de um payload só e não segredo reutilizável — e é o que falta para
fechar as fórmulas da Yampi e da MillionsPay.

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

## Campanhas — o ROAS, e onde ele quebra calado

O gasto vem da Meta; a receita vem daqui. O que os liga é a **UTM de
campanha**, e é exatamente aí que o ROAS quebra na vida real: quem monta o
anúncio escreve `utm_campaign` à mão, ou usa `{{campaign.name}}`, ou
`{{campaign.id}}`.

`cruzar()` em `src/lib/painel/roas.ts` tenta as **duas** formas (id e nome,
sem caixa e sem espaço). E o que NÃO casou **aparece na tela, com nome**:

> um ROAS calculado sobre metade da receita é pior que ROAS nenhum — ele
> parece certo, e a campanha é cortada por um número que estava errado.

A venda **sem UTM nenhuma** é contada à parte, e não como erro: ela não tem o
que casar. É receita real fora de campanha, e o painel diz quanto.

`null`, nunca `Infinity`: campanha sem gasto não tem "retorno sobre gasto", e
`Infinity` apareceria na tela como número.

### O rate limit da Meta — três travas, nenhuma por zelo

A Meta **não** limita por requisições por minuto: dá uma **pontuação** por
conta de negócio, e estourar não devolve 429 educado — a conta fica
**bloqueada por até uma hora**, e nesse tempo o painel não mostra ROAS
nenhum.

| trava | por quê |
|---|---|
| **cache de 15 min** (`meta_insights_cache`) | gasto de mídia não muda de minuto a minuto; abrir a tela cinco vezes não deve custar cinco vezes a cota |
| **fila serial por conta** | em paralelo, três chamadas leem a pontuação ANTES de qualquer uma responder, e as três passam pelo teto juntas |
| **teto de 25%** (`buc.ts`) | a doc trata 70-80% como alerta. Paramos bem antes: painel atrasado cinco minutos é irritante, painel bloqueado uma hora é inútil |

`X-Business-Use-Case-Usage` traz **três** indicadores e o maior manda:
`call_count` é o óbvio, mas uma consulta pesada estoura `total_cputime` muito
antes — olhar só a contagem deixaria a conta ser bloqueada por uma consulta
só. Cabeçalho ausente devolve **zero**, não pânico: a Meta nem sempre manda,
e tratar ausência como "cheio" pararia o painel sem motivo.

**O token vai no cabeçalho `Authorization`, nunca na query.** Ele LÊ a conta
de anúncio inteira — gasto, criativo, público —, e query string aparece em
log de proxy e em histórico de erro.

> **Esta regra já estava escrita duas vezes e foi quebrada assim mesmo.** O
> `meta/testar.ts` — o "Testar conexão" do painel, que roda no minuto em que
> a pessoa acabou de colar a credencial — montava `?access_token=` nas duas
> funções, enquanto o `capi.ts` (corpo) e o `insights.ts` (cabeçalho) ao lado
> faziam certo. Atravessou uma auditoria inteira porque **prosa não varre
> arquivo**. Agora `token-fora-da-query.test.ts` varre o `src/lib/meta/` e
> quebra o build, no molde do `constants.test.ts`. O GA4 fica de fora de
> propósito: o Measurement Protocol EXIGE `api_secret` na query e não oferece
> cabeçalho — trava que não pode ser obedecida vira exceção, e exceção ensina
> a ignorar a regra.

**Cache velho é melhor que tela vazia**, e por isso a falha devolve o que
havia com a data dita: um número de ontem rotulado é informação; um branco
não é.

### O `ate` da Meta é inclusivo; o nosso não

O intervalo do painel tem fim **exclusivo**; o `time_range` da Meta é
inclusivo. Sem o `-1 dia` na conversão, um período de "7 dias" pediria 8 à
Meta — e um ROAS que não fecha é pior que ROAS nenhum.

---

## Autenticação — o que não pode quebrar

- **`setAll` recebe DOIS parâmetros** no `@supabase/ssr` 0.12: `(cookies,
  headers)`. O segundo traz `Cache-Control: private, no-cache, no-store…`, e
  ele **precisa** ser aplicado na resposta. Sem isso, um CDN (a Vercel é um)
  pode cachear uma resposta com `Set-Cookie` de sessão e servir o token de um
  usuário para outro. Exemplos na internet usam a assinatura antiga, de um
  parâmetro só — não copie de lá. Ver `src/lib/supabase/proxy.ts`.
- **E isso vale para ROUTE HANDLER também, não só para o proxy** — foi por
  aí que a regra vazou. O `server.ts` declarava um parâmetro só, justificado
  com "Server Component não escreve cookie": verdade, mas
  `criarClienteServidor()` serve Route Handler igual, e lá o `set`
  **funciona**. O `/auth/callback` grava a sessão e responde com
  `Set-Cookie`; medido num build de produção, um Route Handler que grava
  cookie responde **sem `Cache-Control` nenhum** — o Next não repõe, e o
  `cookies()` não alcança cabeçalho de resposta. Quem escreve sessão usa
  `criarClienteServidorComCabecalhos()` e aplica o que vier; o
  `Object.assign` mora **antes** do `try` porque no Server Component o `set`
  estoura e a explosão não pode levar os cabeçalhos junto.
- **Rate limit não é só para quem tem sessão a proteger — é para quem NÃO
  tem.** `enviarLinkDeAcesso` é Server Action, ou seja, um POST público que
  se alcança sabendo o id, sem passar pelo layout do painel. Ficou sem limite
  porque a auditoria perguntou "checa sessão?" e a resposta ("não, de
  propósito — é onde se obtém uma") encerrou o assunto. O recurso escasso ali
  não é CPU: é a **cota de e-mail** do Supabase, que tem teto baixo por hora
  — martelar a porta queima a cota e quem fica sem entrar no painel é o dono.
  São **dois baldes**, porque são dois abusos: por IP pega o script daqui,
  por e-mail pega o distribuído contra uma caixa só, que é o que de fato
  queima a cota. A recusa usa a mesma frase para todo mundo, senão a tela
  volta a ser verificador de quem tem acesso.
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

## Retenção — o que sai, o que fica

Três tabelas guardam payload cru, e é ele que cresce sem limite: um evento
tem quatro jsonb, um webhook de venda traz o cliente inteiro.

**A LINHA NUNCA É APAGADA.** Só os campos pesados são zerados. Data, evento,
UTMs e geo continuam alimentando o painel — apagar a linha **reescreveria o
passado do faturamento**, e o painel de um mês atrás mudaria sozinho.

| tabela | prazo | por quê |
|---|---|---|
| `events_log` | 14 dias | depurar envio é trabalho da mesma semana |
| `webhooks_recebidos` | **30 ou 90 dias** | 30 se já foi tratado; **90 se ainda pede ação** — ver abaixo |
| `purchases.raw_webhook` | 90 dias | auditoria de venda contestada; o prazo de chargeback chega a 120. **A linha da venda fica para sempre** |

**O prazo do webhook depende do ESTADO da linha, e por pouco não custou
venda.** Aos 30 dias o `corpo` era zerado em toda linha — inclusive nas duas
que o painel pinta pedindo ação: a **amarela** (`adaptador is null`, cujo
payload é o que se lê para escrever o adaptador novo) e a **vermelha**
(`motivo is not null`, que vira venda no minuto em que o cadastro entra e
alguém clica em Reprocessar). O gateway não reenvia para sempre — a Appmax
desiste depois de quatro tentativas, em definitivo e sem avisar —, então
zerado o corpo a venda não volta nunca mais, e o painel seguia exibindo a
linha como se houvesse o que fazer. Agora quem ainda pede ação guarda o
corpo por **90 dias**, o mesmo teto que `purchases.raw_webhook` já aceita
para dado pessoal de webhook. Não é isenção: aos 90 sai também, porque três
meses sem ninguém agir passou o retry de qualquer gateway, passou o
chargeback e passou a campanha. A asserção 10 trava os quatro casos.

**E `corpo is null` tinha DOIS significados, com a tela escolhendo o
errado.** "Não era JSON válido" (o texto cru fica em `corpo_texto`) e "a
retenção zerou" terminam no mesmo `null`, e a tela dizia o primeiro nos dois
— um payload envelhecido lia como gateway quebrado, e o caminho até
descobrir o contrário é depurar do lado de lá. `webhooks_recebidos.purged_at`
é o fato, como `events_log` já tinha; deduzir por "os dois campos estão
nulos" funcionaria hoje e é o mesmo erro do `platform` como proxy de camada.
A decisão de qual frase mostrar é pura e mora em
`src/lib/painel/corpo-do-webhook.ts`, com teste — e os avisos do topo da aba
contam só o que **ainda dá para resolver**, porque instrução que não pode
funcionar ("clique em Reprocessar" numa linha sem corpo) é pior que silêncio.

E há um segundo motivo, que não é de espaço: esses campos guardam **dado
pessoal** — e-mail, telefone, endereço, CPF em alguns gateways. Guardar para
sempre o que só serve para depurar a primeira semana é risco sem
contrapartida.

**Em lotes, com `for update skip locked` e a marca `purged_at`.** Um UPDATE
sobre seis meses de eventos trava a tabela por minutos e a captura **para de
gravar** — o site inteiro perde tracking enquanto a limpeza roda. Com lote e
marca, cada passagem é curta e a seguinte continua de onde parou.

`pg_cron` não existe num Postgres comum, então o teste local tem substituto,
como o Vault já tinha. A asserção 9 prova que o payload some e a linha fica;
a 10, que o prazo maior vale para quem ainda pede ação.

## Banco — como mexer com segurança

- **Os DOIS instaladores são verificados, não só o legível.**
  `02_instalador_atualizado.sh` olhava apenas o `INSTALAR.sql`, e o
  COMPACTO — que é o arquivo que a pessoa realmente cola — ficou defasado
  sem nada avisar quando `painel_cidades` entrou. O estrago é pior no
  compacto: quem instala por ele não recebe a função, a consulta falha em
  silêncio e o cartão de Cidades aparece VAZIO, lendo como "sem dado" em
  vez de "não instalado". A checagem do compacto é por nome de objeto, não
  por linha — ele tem um comando por linha e comparar linha inteira nunca
  casaria.
- **Banco que JÁ ESTÁ NO AR recebe um `ATUALIZAR`, não o instalador
  inteiro.** Fica em `supabase/atualizacoes/`, é a concatenação das
  migrations que entraram desde a última vez, e passa pelo MESMO compactador
  — porque duas migrations já dão 180 linhas e cairiam no corte de 100 do
  editor, com o mesmo erro enganoso. `gerar-compacto.py` aceita
  `<origem> <destino>` para isso. Antes de mandar, aplique num banco montado
  no estado do outro (todas as migrations menos as novas) e rode **duas
  vezes**: é assim que ele chega lá.
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
  aplicadas** — corrija com uma migration nova. **A exceção é idempotência**,
  que não muda o que a migration faz: ver abaixo.
- **Toda migration roda duas vezes sem erro.** Não é zelo — é como migration
  nova chega a um banco que já existe: aqui não há runner que saiba o que já
  foi aplicado, a pessoa cola o arquivo inteiro outra vez. `create trigger` e
  `create policy` não têm `if not exists`, então vão sempre precedidos de
  `drop … if exists`. Sem isso a instalação trava no primeiro objeto que já
  existe, e o erro (`trigger "settings_touch" already exists`) não diz nada
  sobre o que se estava tentando fazer — acrescentar as migrations do fim.
  Consertar isso é o único caso em que se edita migration já aplicada: o
  resultado num banco limpo é idêntico, só deixa de quebrar no banco que já
  tem. `aplicar.sh` aplica tudo **duas vezes**, e o INSTALAR-COMPACTO junto
  porque é o arquivo que a pessoa realmente cola.
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
- [x] **Fase 6** — Dashboard (visão geral, eventos, faturamento, geo)
- [x] **Fase 7** — Campanhas (Meta Ads Insights + ROAS)
- [x] **Fase 8** — Retenção, auditoria e publicação

Cada fase terminou em commit. O passo a passo de subir está em
`docs/PUBLICAR.md`; o que foi verificado antes, em `docs/AUDITORIA.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
