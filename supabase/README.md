# Ligando o Supabase

## Atalho: instalar tudo de uma vez

Cole o arquivo **[`INSTALAR.sql`](./INSTALAR.sql)** inteiro no SQL Editor e
rode. Ele confere o cofre, aplica as migrations e imprime um relatório no
fim. É idempotente — rodar de novo não quebra nada.

Feito isso, pule para o **Passo 4**.

O passo a passo abaixo existe para quem prefere ir por partes ou precisa
entender o que cada pedaço faz.

---

Sete passos, em ordem. Cada um tem como conferir se deu certo antes de
seguir para o próximo.

Tudo aqui é feito no painel do Supabase — nenhuma chave precisa passar por
outro lugar.

---

## Passo 1 · Ativar o cofre (Supabase Vault)

É onde os tokens da Meta e do GA4 ficam guardados, cifrados com uma
chave-mestra que vive **fora** do banco.

**Database → Extensions** → procure **`supabase_vault`** → ative.

Costuma já vir ativo em projeto novo. Para conferir — precisa devolver
`true`:

```sql
select exists (select 1 from pg_namespace where nspname = 'vault') as cofre_ativo;
```

> **Por que não uma chave nossa?** O plano original guardava uma chave no
> catálogo do Postgres com `ALTER DATABASE ... SET`. O Supabase bloqueia esse
> comando (erro `42501`: exige dono do banco). O Vault resolve melhor: a
> chave-mestra nem está no banco, então backup vazado não decifra nada.

---

## Passo 2 · Aplicar as migrations

No **SQL Editor**, rode os quatro arquivos de `supabase/migrations/`,
**nesta ordem**, um de cada vez:

1. `20260921120000_extensoes_e_cifra.sql`
2. `20260921120100_tabelas_config.sql`
3. `20260921120200_tabelas_tracking.sql`
4. `20260921120300_rate_limit_e_cache.sql`

**Conferir** — precisa listar 9 tabelas, todas com `rowsecurity = true`:

```sql
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;
```

Esperado: `events_log`, `ga4_accounts`, `meta_ad_accounts`,
`meta_insights_cache`, `meta_pixels`, `purchases`, `rate_limits`, `settings`,
`visitors`.

---

## Passo 3 · Conferir que o cofre funciona

Vale gastar trinta segundos provando que o ciclo fecha:

```sql
with novo as (
  insert into public.meta_pixels (label, pixel_id)
  values ('Teste', '999999999') returning id
)
select public.set_meta_pixel_secret(id, 'token-de-teste-1234') from novo;

select
  public.get_meta_pixel_secret(id) as do_cofre,     -- token-de-teste-1234
  secret_last4                     as ultimos_4,    -- 1234
  capi_token_secret_id             as ponteiro      -- um uuid
from public.meta_pixels where pixel_id = '999999999';

-- Apagar leva o segredo do cofre junto.
delete from public.meta_pixels where pixel_id = '999999999';
```

---

## Passo 4 · Desligar o cadastro público

**Authentication → Sign In / Providers → Email**

- **Confirm email**: ligado
- **Enable email provider**: ligado
- Em **Authentication → Sign Up**, desligue **Allow new users to sign up**

O código também manda `shouldCreateUser: false` ao pedir o link. São duas
travas independentes: mesmo que uma seja religada por engano, a outra segura.

---

## Passo 5 · Criar o seu usuário

**Authentication → Users → Add user → Create new user**

- E-mail: o seu
- **Auto Confirm User**: ligado

Sem senha — o acesso é por link. Este é o único usuário que existe, e foi
criado à mão.

---

## Passo 6 · Autorizar as URLs de retorno

**Authentication → URL Configuration**

- **Site URL**: `https://track.transforlar.com`
- **Redirect URLs**, some as duas:
  - `https://track.transforlar.com/auth/callback`
  - `http://localhost:3000/auth/callback`

> No Cloudflare, deixe o registro `track` como **DNS only** (nuvem cinza). Com
> o proxy ligado, a Vercel passa a ver o IP do Cloudflare e o geo do visitante
> se perde — ver a nota em `CLAUDE.md`.

Sem isso o link do e-mail chega, mas o Supabase recusa o retorno.

---

## Passo 7 · Pegar as três chaves

**Project Settings → API Keys**

| Variável | Onde está |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable / anon |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secret / service_role (atrás de "Reveal") |

Elas vão para três lugares, e **nunca** para o repositório:

- `.env.local` na sua máquina (copiado do `.env.example`)
- Environment Variables do ambiente do Claude Code
- Vercel → Settings → Environment Variables

---

## Conferindo o resultado

Com o `.env.local` preenchido:

```bash
npm run dev
```

1. Abra `http://localhost:3000` → deve te levar para `/login`
2. Digite seu e-mail → "Link enviado"
3. Clique no link do e-mail → cai no painel
4. Digite um e-mail que **não** tem conta → a mesma mensagem de sucesso, e
   nenhum e-mail chega. É de propósito: a tela não revela quem tem acesso.

---

## Rodando as migrations localmente (opcional)

Para validar mudanças no SQL sem tocar no projeto de verdade:

```bash
./supabase/tests/aplicar.sh
```

Aplica tudo num Postgres local e roda as asserções de segurança — as mesmas
que o CI roda a cada push.
