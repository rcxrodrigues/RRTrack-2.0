# Auditoria de segurança — 25/09/2026

O que foi verificado antes de publicar, item a item, com o resultado e o
método. Refazer é reexecutar os mesmos comandos.

---

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

`supabase/tests/01_seguranca.sql`, **nove asserções**, rodando no CI a cada
push. Cobrem: RLS ligada em todas as tabelas, zero policies de escrita,
ponteiros do cofre fora do alcance do painel, `anon` sem privilégio em nada,
funções do cofre só para `service_role`, o ciclo do Vault, a janela do rate
limit, `settings` trancada em uma linha, as consultas do painel respeitando a
RLS de quem chama, e a retenção zerando payload sem apagar linha.

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

---

## 🔧 Corrigido nesta auditoria

### O corpo do webhook não tinha teto

`request.text()` lia qualquer tamanho. O token barra quem não deveria estar
ali, mas um gateway com bug — ou um payload com um PDF em base64 dentro —
chegaria inteiro: parseado, gravado em `webhooks_recebidos` e replicado em
`purchases.raw_webhook`. Um corpo de 50 MB vira 100 MB de banco por webhook,
e a tabela de auditoria é justamente a que ninguém olha crescer.

Agora: **1 MB**, e **413** em vez de 202 — reenviar o mesmo corpo gigante
falharia igual, e o gateway precisa saber que o problema é o tamanho.

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
