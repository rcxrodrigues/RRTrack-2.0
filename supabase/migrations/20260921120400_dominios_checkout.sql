-- =============================================================================
-- 0005 · Domínios de checkout configuráveis
-- =============================================================================
-- O snippet marca com o trck_user_id todo link que aponta para o checkout —
-- é essa a ponte cross-domain, já que o checkout é outro site.
--
-- A lista NASCEU dentro do snippet, com as plataformas de infoproduto
-- (hotmart, kiwify, eduzz…). Estava errada por dois motivos:
--
--   1. a primeira loja é Shopify com checkout de terceiro, e nenhum daqueles
--      domínios aparece no funil dela;
--   2. cada oferta futura usa o checkout que quiser, e trocar isso não pode
--      exigir deploy.
--
-- Agora é configuração. O WhatsApp continua no código porque é universal e
-- porque o mecanismo é outro: lá o id vai no TEXTO da mensagem, não na query.
-- =============================================================================

alter table public.settings
  add column if not exists checkout_domains text[] not null default '{}';

comment on column public.settings.checkout_domains is
  'Domínios do checkout. O snippet marca com trck_user_id todo link que aponte para um deles. Ex.: {seguro.pagou.ai, checkout.minhaloja.com}';

-- O painel lê a coluna nova. Como o SELECT da tabela foi revogado e devolvido
-- coluna a coluna (ver 0002), uma coluna nova NÃO é visível por herança:
-- precisa do grant explícito, ou a tela quebra com "permission denied".
grant select (checkout_domains) on public.settings to authenticated;
