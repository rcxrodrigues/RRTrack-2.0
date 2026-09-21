# RRTrack 2.0

Tracking server-side com painel próprio: captura o visitante, dispara os eventos
pelo navegador **e** pelo servidor com o mesmo `event_id` (deduplicado), casa a
venda do webhook de volta com quem a originou e cruza gasto de mídia com receita
real para mostrar ROAS e CPA confiáveis.

**Stack:** Next.js 16 (App Router) · TypeScript 7 · Tailwind CSS 4 · Supabase
(Postgres + Auth) · Meta Conversions API · GA4 · deploy na Vercel.

## Começando

```bash
npm install
cp .env.example .env.local   # preencha com os dados do seu projeto Supabase
npm run dev
```

## Documentação

Arquitetura, decisões, convenções e regras de segurança estão no
[`CLAUDE.md`](./CLAUDE.md). Leia antes de mexer — em especial as seções de
**TypeScript 7** e **Segurança**.
