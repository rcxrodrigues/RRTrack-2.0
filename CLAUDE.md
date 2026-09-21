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
é o que permite cookie de primeira parte:

```
oferta.com          LP / site de vendas (externo)
                    roda <script src="https://dash.oferta.com/t.js">
dash.oferta.com     ESTE app: painel + APIs de captura + webhook
checkout externo    Hotmart / Kiwify / Eduzz — outro site
```

- **Cookie `_trck` com `Domain=.oferta.com`** vale na LP e no painel. É cookie
  de primeira parte: o Safari não descarta e o ITP não corta em 7 dias.
- LP → painel é cross-**origin** (precisa de CORS) mas same-**site**, então o
  cookie viaja com `SameSite=Lax` + `credentials: 'include'`.
- O checkout é outro site, e por isso **o `trck_user_id` viaja na URL** do
  checkout e nos links de WhatsApp. É essa a ponte cross-domain.

CORS nunca fica aberto: a allowlist de origens é configurada no painel.

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
**pelo painel** e ficam cifrados no banco:

| Tabela | Conteúdo |
|---|---|
| `settings` | linha única: `webhook_token`, `currency`, `test_event_code`, origens permitidas |
| `ga4_accounts` | N propriedades GA4: `measurement_id` + `api_secret` |
| `meta_pixels` | N pixels: `pixel_id` + `capi_token` |
| `meta_ad_accounts` | N contas de anúncio: `ad_account_id` + `ads_token` |

Os eventos são enviados a **todos** os destinos ativos, e a resposta de cada um
é gravada no log do evento.

### Cifra dos segredos — pgcrypto, e o seu limite

Segredos são `bytea` via `pgp_sym_encrypt`. A chave **não fica numa tabela** —
fica no catálogo do Postgres:

```sql
ALTER DATABASE postgres SET app.settings.encryption_key = '<chave forte>';
```

Lida com `current_setting(...)` dentro de funções `SECURITY DEFINER`, com
`REVOKE` de `anon` e `authenticated`. O painel nunca recebe o segredo: lê
`secret_last4` e mostra `••••••••4f2a`.

**O limite, dito com clareza:** um `pg_dump` das *tabelas* não decifra nada,
porque a chave não está nelas. Mas um `pg_dumpall` inclui as configurações de
banco e leva a chave junto. O Supabase Vault seria mais forte (chave-mestra
fora do Postgres). A interface `set_*_secret` / `get_*_secret` foi desenhada
para que trocar pgcrypto por Vault não toque em código de aplicação.

---

## Design system

- **Cores em HSL** em variáveis CSS — `142 76% 58%`, sem a função `hsl()` em
  volta, para permitir `hsl(var(--primary) / 0.3)`. O shadcn novo usa OKLCH;
  aqui é HSL de propósito. Ao trazer um componente do shadcn, converta.
- Primária verde-neon: `142 76% 58%` no escuro, `142 70% 26%` no claro.
  Accents: ciano e âmbar. `--radius: 0.625rem`.
- **Escuro é o padrão.** O `<html>` já nasce com `class="dark"` no SSR, então o
  tema certo aparece antes do JS — e continua certo se o JS não carregar.
- Manrope (texto) e JetBrains Mono (números e JSON), via `next/font`.
  **Todo número usa `font-variant-numeric: tabular-nums`** (classe `.tabular`
  ou `data-slot="metric"`), para a métrica não dançar ao atualizar.
- `.glass`: blur + borda translúcida + brilho interno. Use em cartão de
  conteúdo, não em tudo.
- **Mobile-first.** Alvos de toque ≥ 44px (o `size="default"` do Button já dá
  `h-11` no celular). Sidebar no desktop, barra inferior no celular —
  `src/lib/nav.ts` é a fonte única das duas.
- Métrica sem dado mostra **`—`, nunca `0`**: zero é um número, "sem dado" não é.
  É o que o `MetricCard` faz quando recebe `value={null}`.

---

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
- [ ] **Fase 1** — Banco, RLS e autenticação (magic link)
- [ ] **Fase 2** — Configuração das contas pelo painel
- [ ] **Fase 3** — Captura (`/t.js`, `/api/identify`, `/api/event`)
- [ ] **Fase 4** — Destinos server-side (Meta CAPI + GA4)
- [ ] **Fase 5** — Webhook de compra (Hotmart / Kiwify / Eduzz)
- [ ] **Fase 6** — Dashboard
- [ ] **Fase 7** — Campanhas (Meta Ads Insights + ROAS)
- [ ] **Fase 8** — Retenção, auditoria e publicação

Cada fase termina em commit e espera aprovação antes da seguinte.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
