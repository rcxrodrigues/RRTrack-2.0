# Auditoria de segurança

O que foi verificado, item a item, com o resultado e o método. Refazer é
reexecutar os mesmos comandos.

Duas passadas até agora. A de 25/09 foi antes de publicar; a de 29/09 veio
depois de oito commits que a primeira não tinha visto — **e é essa a lição
que a segunda deixou**: auditoria tem data de validade, e a regra escrita em
prosa não varre arquivo nenhum. Dos três achados de 29/09, dois eram regras
que já estavam no CLAUDE.md, escritas com todas as letras, quebradas em
arquivos que a prosa não alcançava.

---

# 29/09/2026 — segunda passada

Motivo: oito commits desde a primeira, incluindo coluna nova no banco
(`purged_at`), função nova (`painel_geo_arvore`) e uma tela que passou a
exibir IP. E o cadastro das credenciais reais estava prestes a acontecer.

## 🔧 Corrigido nesta passada

### O callback do magic link perdia os cabeçalhos anti-cache da sessão

O `setAll` do `@supabase/ssr` 0.12 recebe **dois** parâmetros, e o segundo
traz `Cache-Control: private, no-cache, no-store`, `Expires: 0` e
`Pragma: no-cache`. O `proxy.ts` aplicava os três — está documentado lá e no
CLAUDE.md. O `server.ts` declarava `setAll(cookiesToSet)`, com **um**, e os
descartava calado.

O comentário justificava com *"Server Components não podem escrever
cookies"*, e isso é verdade — mas `criarClienteServidor()` também serve
**Route Handlers**, onde o `set` funciona. O caso concreto é
`/auth/callback`: ele troca o `code` pela sessão e responde com `Set-Cookie`
do token.

**Medido, não deduzido.** Uma rota-sonda que só grava cookie, num build de
produção:

```
HTTP/1.1 307 Temporary Redirect
set-cookie: sonda-sessao=valor-de-teste; Path=/; HttpOnly
                       ← nenhum Cache-Control. O Next não repõe.
```

E a doc do pacote instalado (`@supabase/ssr/dist/main/types.d.ts`) diz para
que servem, com todas as letras: *"Responses that set auth cookies must not
be cached by CDNs or reverse proxies, otherwise one user's session token can
be served to a different user."*

O mecanismo ficou no `server.ts`, não na rota:
`criarClienteServidorComCabecalhos()` devolve o cliente **e** um objeto vivo
que o `setAll` enche — para quem escrever o próximo Route Handler não
precisar lembrar. O `Object.assign` vem **antes** do `try` de propósito: num
Server Component o `set` estoura, e a explosão não pode levar os cabeçalhos
junto.

---

### Os dois tokens da Meta iam na query string do "Testar conexão"

`src/lib/meta/testar.ts` montava `?access_token=…` nas duas funções. O
CLAUDE.md proíbe isso **duas vezes**, uma por token, com o motivo: query
string aparece em log de proxy, em histórico de erro e em relatório de
crash. E não é token qualquer — o da CAPI **escreve** no pixel, o de Ads
**lê** a conta de anúncio inteira (gasto, criativo, público).

O contraste é o que denuncia: `capi.ts` manda no corpo do POST,
`insights.ts` manda em `Authorization: Bearer`, os dois com o comentário
citando a regra. O `testar.ts` era a porta que faltava fechar — e é
justamente a que roda no minuto em que a pessoa acaba de colar a credencial.

Passou por uma auditoria inteira sem ninguém reparar, porque **regra em prosa
não varre arquivo**. Agora `token-fora-da-query.test.ts` varre o
`src/lib/meta/` e quebra o build se voltar, no mesmo molde do
`constants.test.ts`.

> O GA4 fica **fora** da trava, de propósito: o Measurement Protocol exige
> `api_secret` na query e não oferece cabeçalho. Trava que não pode ser
> obedecida vira exceção, e exceção ensina a ignorar a regra.

---

### O envio do link de acesso não tinha rate limit

`enviarLinkDeAcesso` tinha Zod e não tinha limite. **Server Action é endpoint
público** — um POST que se alcança sabendo o id, sem passar pelo layout do
painel — e a regra 5 diz *"sem exceção"*.

O recurso escasso aqui não é CPU: é a **cota de e-mail**. O SMTP do Supabase
tem teto baixo por hora, e o próprio código já tratava
`over_email_send_rate_limit`. Quem martelasse a porta queimava a cota, e quem
ficava sem entrar no painel era o dono — na hora em que precisa.
`shouldCreateUser: false` impede criar conta, e a resposta idêntica impede
descobrir quem tem acesso; **nenhum dos dois impede esgotar a cota**.

São **dois baldes**, porque são dois abusos:

| balde | pega |
|---|---|
| `login:ip:<ip>` | o script que dispara mil pedidos daqui |
| `login:email:<email>` | o distribuído contra uma caixa só — o que de fato queima a cota |

Um balde só deixaria metade da porta aberta, e o teste prova isso: tirar o de
e-mail reprova dois casos, tirar o de IP reprova outros dois. A recusa usa a
mesma frase para todo mundo, então a tela continua não sendo verificador de
quem tem acesso.

---

## ✅ Passou — e como foi verificado

| item | método | resultado |
|---|---|---|
| Segredo no histórico | varredura de `EAA…`, `sb_secret_…`, JWT em **79 commits** | nada; só `.env.example` já existiu |
| RLS, grants, cofre | `aplicar.sh` num Postgres limpo | **10 asserções + 3b/3c/3d**, migrations 2×, os dois instaladores |
| `search_path` das `security definer` | consulta ao catálogo | **15 de 15** com `search_path=""` |
| Coluna nova invisível ao painel | `has_column_privilege` coluna a coluna | só os 4 ponteiros do cofre e a `rate_limits`; **`purged_at` visível** |
| Função nova do painel | asserção 8, que varre por `painel\_%` | `painel_geo_arvore` é `invoker`, `anon` não executa |
| `service_role` no bundle | build com chave marcada + `grep` em `.next/static/` | **não aparece** em nenhum dos 24 chunks |
| `NEXT_PUBLIC_` | varredura do `src/` | só a URL e a anon key |
| Segredo em log | os **57** `console.*` do `src/`, um a um | nenhum imprime token, e-mail ou payload inteiro |
| CORS falha fechado | `curl` com origem não cadastrada, build de produção | **403** + `no-store`, com o Supabase quebrado |
| Token do webhook | `curl` com token errado | **401** |
| Rate limit falha aberto | leitura do `catch` + comentário | deliberado, e oposto ao CORS de propósito |
| Server Actions checam sessão | as **11** do `(dash)`, uma a uma | todas chamam `usuarioAtual()` |
| Injeção | `dangerouslySetInnerHTML`, `eval`, `new Function` | nenhuma ocorrência |
| `target="_blank"` sem `noopener` | varredura | nenhuma |
| Unidade por gateway | os 5 `*.test.ts` | 25990→259,90 · 199,90→199,90 · 110→110 · 9700→97 |
| Escada de status | `processar.test.ts` | os dois sentidos, com os casos que inflam e que perdem receita |
| Duplicata entre camadas | `compras.test.ts` | inclusive o caso Pagou (checkout **e** gateway) |

Total: **709 testes**, `npm run check` verde.

---

## ⚠️ Observações, sem ação

- **`x-forwarded-host` monta a origem do redirect** em `/auth/callback` e no
  login. O caminho já passa por `caminhoInterno()`; o que vem do cabeçalho é
  só o host. Para explorar seria preciso controlar o `Host` da requisição da
  **vítima**, e o navegador dela o define a partir do domínio que ela abriu.
  O vetor que restava era envenenar cache — e é o que a correção acima
  fechou.
- **`/t.js` é `public, max-age=300, stale-while-revalidate=3600`.** É
  deliberado e continua certo, mas tem uma consequência operacional que não é
  de segurança: **trocar um pixel ou uma propriedade do GA4 pode levar até
  uma hora** para chegar a todo mundo. Se precisar da troca na hora, purgue o
  cache do Cloudflare.

---

# 25/09/2026 — primeira passada

Antes de publicar.

## ✅ Passou

### Nenhum segredo no histórico do git

```bash
git log --all --diff-filter=A --name-only --format="" | sort -u \
  | grep -Ei '\.env($|\.)|secret|\.pem$|credential'
git grep -nIE 'eyJ[A-Za-z0-9_-]{20,}\.|sk_live|pk_live|EAA[A-Za-z0-9]{30,}' $(git rev-list --all)
```

O único arquivo é `.env.example`, que só tem nomes de variável. Nenhuma
chave, token ou JWT em nenhum commit.

> Se um dia vazar: **rotacione a chave**, não apague o arquivo. Commit
> apagado continua no histórico de quem clonou.

### `service_role` nunca alcança o navegador

`src/lib/supabase/admin.ts` tem `import 'server-only'` no topo — quem o
importar de um componente cliente **quebra o build**, não vaza. A barreira é
o compilador, não a memória de quem lê. Verificado também por varredura:
nenhum arquivo com `'use client'` importa `criarClienteAdmin`.

### Nada sensível com `NEXT_PUBLIC_`

Só as duas variáveis do Supabase que **devem** ser públicas (URL e anon key).
Nenhum token da Meta, `api_secret` do GA4 ou token de webhook passa por ali —
todos vivem no Vault.

### RLS e privilégios, tabela a tabela

`supabase/tests/01_seguranca.sql`, **dez asserções**, rodando no CI a cada
push. Cobrem: RLS ligada em todas as tabelas, zero policies de escrita,
ponteiros do cofre fora do alcance do painel, `anon` sem privilégio em nada,
funções do cofre só para `service_role`, o ciclo do Vault, a janela do rate
limit, `settings` trancada em uma linha, as consultas do painel respeitando a
RLS de quem chama, a retenção zerando payload sem apagar linha, e o prazo
maior para o webhook que ainda pede ação — o corpo de uma linha amarela ou
vermelha é o que o Reprocessar lê, e zerado aos 30 dias junto com as verdes a
venda não voltava nunca mais.

### Cadastro público desligado

`shouldCreateUser: false` no `signInWithOtp` (`src/app/login/actions.ts`) — a
trava no código. A do painel do Supabase é a segunda. E a tela de login
responde **igual** existindo ou não o e-mail, senão viraria um verificador de
quem tem acesso.

### Redirect não vira trampolim de phishing

Todo redirect passa por `caminhoInterno()` (`src/lib/rotas.ts`), com teste
contra os vetores de ataque.

### Server Actions checam sessão

As duas que mutam (`config/actions.ts`, `eventos/actions.ts`) chamam
`usuarioAtual()` em toda entrada. `login/actions.ts` não checa **de
propósito**: é onde se vai para obter uma sessão.

> 🔎 **A segunda passada achou o furo que este parágrafo escondia.** "Não
> checa de propósito" estava certo e respondia a pergunta errada: sem sessão
> a exigir, o que protege um endpoint público é o **rate limit** — e esse
> não havia. Ver 29/09.

---

## 🔧 Corrigido nesta passada

### O corpo do webhook não tinha teto

`request.text()` lia qualquer tamanho. O token barra quem não deveria estar
ali, mas um gateway com bug — ou um payload com um PDF em base64 dentro —
chegaria inteiro: parseado, gravado em `webhooks_recebidos` e replicado em
`purchases.raw_webhook`. Um corpo de 50 MB vira 100 MB de banco por webhook,
e a tabela de auditoria é justamente a que ninguém olha crescer.

Agora: **1 MB**, e **413** em vez de 202 — reenviar o mesmo corpo gigante
falharia igual, e o gateway precisa saber que o problema é o tamanho.

---

### O token do webhook ficava em texto puro na linha de auditoria

`registrarRecebido()` gravava `Object.fromEntries(headers.entries())` — todos
os cabeçalhos, verbatim. E o token chega num deles: `Authorization: Bearer` na
Zedy, `x-webhook-token` no genérico, `x-adoorei-hash` na Adoorei.

Isso punha o token:

1. numa coluna `jsonb` que qualquer `authenticated` lê pelo PostgREST;
2. **impresso na tela** do painel, na gaveta de cabeçalhos;
3. em todo backup do banco, por 30 a 90 dias (o prazo depende do estado da
   linha), até a retenção zerar a coluna.

É a mesma armadilha que o `payload_meta` já desvia — *"um token ali seria
segredo vazado em repouso"* — por outra porta. E é exatamente o que a escolha
do Vault existe para evitar: o valor nunca deve passar por uma coluna nossa.

O estrago não é hipotético: esse token é o que autoriza gravar uma venda.
Vazado, dá para inventar faturamento e mandar conversão falsa para a Meta.

**Corrigido** em `cabecalhosSeguros()`. O mascaramento é por **valor**, não por
nome: a lista de nomes cresce a cada gateway — já são três mais o
`authorization` — e esquecer um seria silencioso. Comparar contra o token
configurado pega qualquer cabeçalho que o carregue, inclusive o que um gateway
futuro inventar.

O **nome** de todos fica, porque é ele que tem valor de diagnóstico. As
assinaturas HMAC também ficam: são resumo de um payload só, não segredo
reutilizável, e são o que falta para fechar as fórmulas da Yampi e da
MillionsPay. Oito testes em `cabecalhos.test.ts`.

> 🔴 **Se você já disparou algum webhook de teste antes desta correção**, as
> linhas antigas ainda têm o token. Gere um token novo no painel — é um
> clique — ou apague as linhas de `webhooks_recebidos`.

---

## ⚠️ Exceções deliberadas, com o motivo

A regra do projeto diz *"todo endpoint público valida com Zod e tem rate
limit, sem exceção"*. Duas rotas não seguem a letra, e vale dizer por quê em
vez de fingir que seguem.

### `/t.js` — sem Zod e sem rate limit

**Sem Zod** porque não há entrada: é um `GET` sem corpo e sem parâmetro que
mude a resposta.

**Sem rate limit** por uma razão que inverte o custo: o limitador grava no
Postgres a cada janela. Um `t.js` com rate limit faria **uma escrita no banco
por carregamento de script** — mais caro que o ataque que evitaria. A
resposta é `public, max-age=300, stale-while-revalidate=3600`, então o CDN
absorve o tráfego normal, e o conteúdo só tem ids de GA4 e de pixel, que
qualquer visitante já enxerga no fonte da página.

> O que sobra de exposição é custo de função na Vercel, não vazamento. Se um
> dia isso incomodar, o caminho é limite no CDN, não escrita no banco.

### `/api/webhook/compra` — sem Zod

Tem rate limit e token. Não tem Zod porque **os adaptadores são o
validador**: `reconhece()` recusa o que não é do formato e `normalizar()`
recusa o que não vira venda — com **105 asserções** contra payloads reais
publicados pelos gateways.

Um schema Zod por gateway duplicaria isso e criaria a chance de os dois
divergirem. O que faltava do Zod era só o teto de tamanho, e ele foi
acrescentado acima.

---

## 🔴 Não verificável daqui — depende de produção

| item | como conferir |
|---|---|
| Cadastro público desligado **no painel do Supabase** | Authentication → Providers → Email → *Enable signup* **off** |
| `SUPABASE_SERVICE_ROLE_KEY` só no servidor da Vercel | Settings → Environment Variables: a chave **não** pode ter o prefixo `NEXT_PUBLIC_` |
| DNS do painel em **DNS only** | Cloudflare, registro `track`: nuvem **cinza**. Laranja quebra o geo e degrada o match na Meta |
| `pg_cron` habilitado | Supabase → Database → Extensions → `pg_cron`. Depois: `select * from cron.job` |
| A rotina de retenção rodando | `select * from cron.job_run_details order by start_time desc limit 5` |
