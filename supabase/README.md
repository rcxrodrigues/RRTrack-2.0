# Ligando o Supabase

Sete passos, em ordem. Cada um tem como conferir se deu certo antes de
seguir para o próximo.

Tudo aqui é feito no painel do Supabase — nenhuma chave precisa passar por
outro lugar.

---

## Passo 1 · Gerar a chave de cifra

É com ela que os tokens da Meta e do GA4 ficam cifrados no banco.

No **SQL Editor**, rode:

```sql
do $$
declare
  v_chave text;
begin
  -- Dois UUIDs v4 concatenados: 64 caracteres, ~244 bits de entropia.
  v_chave := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  execute format(
    'alter database %I set app.settings.encryption_key = %L',
    current_database(), v_chave
  );
end;
$$;
```

A chave é gerada e gravada **dentro do banco**. Ela nunca aparece na tela,
nunca passa por e-mail, chat ou arquivo — não há como vazá-la por descuido.

> **Guarde uma cópia?** Não precisa, e é melhor não. Se um dia ela se perder,
> os segredos cifrados ficam ilegíveis — mas é só recadastrar os tokens no
> painel, que leva dois minutos. Uma cópia em lugar errado é risco permanente;
> recadastrar é um aborrecimento passageiro.

**Conferir** — precisa devolver `64`:

```sql
select length(current_setting('app.settings.encryption_key', true));
```

Se vier vazio ou `NULL`, abra uma aba nova do SQL Editor: a configuração só
vale para conexões abertas depois do `ALTER DATABASE`.

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

## Passo 3 · Conferir que a cifra funciona

Vale gastar trinta segundos provando que o ciclo fecha:

```sql
-- Cria um pixel de teste, cifra um token e lê de volta.
with novo as (
  insert into public.meta_pixels (label, pixel_id)
  values ('Teste', '999999999') returning id
)
select public.set_meta_pixel_secret(id, 'token-de-teste-1234') from novo;

select
  public.get_meta_pixel_secret(id) as decifrado,   -- token-de-teste-1234
  secret_last4                     as ultimos_4,   -- 1234
  length(capi_token_enc)           as bytes_cifrados
from public.meta_pixels where pixel_id = '999999999';

-- Limpa o teste.
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

- **Site URL**: `http://localhost:3000` enquanto desenvolve; depois o domínio
  do painel (`https://dash.suaoferta.com`)
- **Redirect URLs**, some as duas:
  - `http://localhost:3000/auth/callback`
  - `https://dash.suaoferta.com/auth/callback`

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
