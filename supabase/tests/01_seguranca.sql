-- =============================================================================
-- Asserções de segurança. Cada bloco levanta exceção se a garantia não valer.
-- Roda contra um Postgres local com o ambiente Supabase emulado.
-- =============================================================================
\set ON_ERROR_STOP on

-- 1) RLS ligada em TODAS as tabelas de public -------------------------------
do $$
declare v_faltando text[];
begin
  select array_agg(c.relname order by c.relname) into v_faltando
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if v_faltando is not null then
    raise exception 'FALHA: tabelas sem RLS: %', v_faltando;
  end if;
  raise notice 'OK 1/9 · RLS ligada em todas as tabelas';
end;
$$;

-- 2) Nenhuma policy de escrita ----------------------------------------------
do $$
declare v_escrita text[];
begin
  select array_agg(tablename || ' → ' || policyname) into v_escrita
    from pg_policies
   where schemaname = 'public' and cmd <> 'SELECT';

  if v_escrita is not null then
    raise exception 'FALHA: existe policy de escrita: %', v_escrita;
  end if;
  raise notice 'OK 2/9 · Nenhuma policy de escrita — só service_role grava';
end;
$$;

-- 3) Colunas de segredo invisíveis para anon e authenticated ----------------
do $$
declare
  v_par record;
  v_vaza text[] := '{}';
begin
  for v_par in
    select * from (values
      ('settings','webhook_token_secret_id'),
      ('ga4_accounts','api_secret_secret_id'),
      ('meta_pixels','capi_token_secret_id'),
      ('meta_ad_accounts','ads_token_secret_id')
    ) as t(tabela, coluna)
  loop
    if has_column_privilege('anon', 'public.' || v_par.tabela, v_par.coluna, 'SELECT')
       or has_column_privilege('authenticated', 'public.' || v_par.tabela, v_par.coluna, 'SELECT') then
      v_vaza := v_vaza || (v_par.tabela || '.' || v_par.coluna);
    end if;
  end loop;

  if array_length(v_vaza, 1) > 0 then
    raise exception 'FALHA: ponteiro de segredo legível pelo painel: %', v_vaza;
  end if;
  raise notice 'OK 3/9 · Ponteiros para o cofre fora do alcance do painel';
end;
$$;

-- 3d) O outro lado da armadilha: coluna NÃO-secreta precisa ser VISÍVEL ------
--
-- Como o SELECT da tabela foi revogado e devolvido coluna a coluna, toda
-- coluna nova nasce INVISÍVEL para o painel até alguém escrever o grant.
-- A 3) guarda o lado do vazamento; esta guarda o lado de a tela quebrar com
-- "permission denied" em produção.
do $$
declare
  v_par record;
  v_falta text[] := '{}';
begin
  for v_par in
    select * from (values
      ('settings','currency'),
      ('settings','allowed_origins'),
      ('settings','checkout_domains'),
      ('settings','cookie_domain'),
      ('settings','webhook_token_last4'),
      ('ga4_accounts','measurement_id'),
      ('meta_pixels','pixel_id'),
      ('meta_ad_accounts','ad_account_id')
    ) as t(tabela, coluna)
  loop
    if not has_column_privilege('authenticated', 'public.' || v_par.tabela, v_par.coluna, 'SELECT') then
      v_falta := v_falta || (v_par.tabela || '.' || v_par.coluna);
    end if;
  end loop;

  if array_length(v_falta, 1) > 0 then
    raise exception 'FALHA: o painel não consegue ler: % (falta o grant select (coluna))', v_falta;
  end if;
  raise notice 'OK 3d · Colunas não-secretas legíveis pelo painel';
end;
$$;

-- 3b) Nem anon nem authenticated podem escrever em nada --------------------
do $$
declare v_escrita text[];
begin
  select array_agg(distinct t.table_name || ' → ' || g.grantee || ' → ' || g.privilege_type)
    into v_escrita
    from information_schema.tables t
    join information_schema.role_table_grants g
      on g.table_schema = t.table_schema and g.table_name = t.table_name
   where t.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and g.grantee in ('anon', 'authenticated')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  if v_escrita is not null then
    raise exception 'FALHA: privilégio de escrita concedido: %', v_escrita;
  end if;
  raise notice 'OK 3b · Nem anon nem authenticated têm privilégio de escrita';
end;
$$;

-- 3c) anon não alcança nenhuma tabela ---------------------------------------
do $$
declare v_alcanca text[];
begin
  select array_agg(distinct g.table_name || ' → ' || g.privilege_type)
    into v_alcanca
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.grantee = 'anon';

  if v_alcanca is not null then
    raise exception 'FALHA: anon ainda alcança tabelas: %', v_alcanca;
  end if;
  raise notice 'OK 3c · anon não tem privilégio em tabela nenhuma';
end;
$$;

-- 4) anon não executa as funções de segredo ---------------------------------
do $$
declare v_pode text[] := '{}';
begin
  if has_function_privilege('anon', 'public.get_webhook_token()', 'EXECUTE') then
    v_pode := v_pode || 'anon→get_webhook_token';
  end if;
  if has_function_privilege('authenticated', 'public.get_meta_pixel_secret(uuid)', 'EXECUTE') then
    v_pode := v_pode || 'authenticated→get_meta_pixel_secret';
  end if;
  if has_function_privilege('anon', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE') then
    v_pode := v_pode || 'anon→check_rate_limit';
  end if;

  if array_length(v_pode, 1) > 0 then
    raise exception 'FALHA: função sensível executável: %', v_pode;
  end if;
  raise notice 'OK 4/9 · Funções de segredo só para o service_role';
end;
$$;

-- 5) O cofre funciona de ponta a ponta -------------------------------------
do $$
declare
  v_id        uuid;
  v_segredo   text := 'EAAG-token-de-teste-super-secreto-1234';
  v_lido      text;
  v_ponteiro  uuid;
  v_last4     text;
  v_substituto boolean;
begin
  insert into public.meta_pixels (label, pixel_id)
  values ('Teste', '123456789') returning id into v_id;

  perform public.set_meta_pixel_secret(v_id, v_segredo);

  select public.get_meta_pixel_secret(v_id) into v_lido;
  if v_lido is distinct from v_segredo then
    raise exception 'FALHA: lido do cofre (%) diferente do guardado', v_lido;
  end if;

  select capi_token_secret_id, secret_last4 into v_ponteiro, v_last4
    from public.meta_pixels where id = v_id;

  if v_ponteiro is null then
    raise exception 'FALHA: a conta ficou sem ponteiro para o cofre';
  end if;
  if v_last4 <> '1234' then
    raise exception 'FALHA: last4 esperado 1234, veio %', v_last4;
  end if;

  -- Trocar o token reaproveita o mesmo ponteiro: nada de segredo órfão.
  perform public.set_meta_pixel_secret(v_id, 'novo-token-5678');
  if (select capi_token_secret_id from public.meta_pixels where id = v_id) <> v_ponteiro then
    raise exception 'FALHA: atualizar o token criou um segredo novo em vez de trocar';
  end if;
  if public.get_meta_pixel_secret(v_id) <> 'novo-token-5678' then
    raise exception 'FALHA: o cofre não devolveu o token atualizado';
  end if;

  -- Apagar a conta tem que levar o segredo junto.
  delete from public.meta_pixels where id = v_id;
  if exists (select 1 from vault.secrets where id = v_ponteiro) then
    raise exception 'FALHA: o segredo continuou no cofre depois de apagar a conta';
  end if;

  select obj_description(oid, 'pg_namespace') like '%SUBSTITUTO%'
    into v_substituto
    from pg_namespace where nspname = 'vault';

  if coalesce(v_substituto, false) then
    raise notice 'OK 5/9 · Cofre: guarda, lê, atualiza sem órfão e limpa ao apagar';
    raise notice '         (substituto local — a cifra em si é do Vault, testada no Supabase)';
  else
    raise notice 'OK 5/9 · Cofre: guarda, lê, atualiza sem órfão e limpa ao apagar';
  end if;
end;
$$;

-- 6) Rate limit é atômico e corta no limite ----------------------------------
do $$
declare
  r1 boolean; r2 boolean; r3 boolean;
begin
  select public.check_rate_limit('teste:1.2.3.4', 2, 60) into r1;
  select public.check_rate_limit('teste:1.2.3.4', 2, 60) into r2;
  select public.check_rate_limit('teste:1.2.3.4', 2, 60) into r3;

  if not r1 or not r2 then
    raise exception 'FALHA: as duas primeiras deveriam passar (%, %)', r1, r2;
  end if;
  if r3 then
    raise exception 'FALHA: a terceira deveria ser barrada';
  end if;

  -- Bucket diferente não compartilha contador.
  if not public.check_rate_limit('teste:5.6.7.8', 2, 60) then
    raise exception 'FALHA: bucket diferente não deveria estar limitado';
  end if;

  delete from public.rate_limits where bucket like 'teste:%';
  raise notice 'OK 6/9 · Rate limit corta no limite e isola por bucket';
end;
$$;

-- 7) settings é mesmo uma linha só -------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.settings;
  if v_n <> 1 then
    raise exception 'FALHA: settings deveria ter 1 linha, tem %', v_n;
  end if;

  begin
    insert into public.settings (id) values (false);
    raise exception 'FALHA: aceitou uma segunda linha em settings';
  exception
    when check_violation then null;  -- esperado
  end;

  raise notice 'OK 7/9 · settings trancada em uma linha';
end;
$$;

-- 8) as consultas do painel rodam com a RLS de QUEM CHAMA --------------------
-- Uma função `security definer` roda com os privilégios de quem a CRIOU e
-- ignora a RLS das tabelas por baixo. Nas do cofre isso é o ponto; nas do
-- painel seria um buraco que devolve agregado de dados que a política nega —
-- sem erro, sem aviso, parecendo funcionar. Vale para views também, que por
-- padrão rodam como o dono a não ser que tenham `security_invoker = true`.
do $$
declare
  v_definer text[];
  v_frouxas text[];
  v_anon    text[];
begin
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'painel\_%'
    and p.prosecdef;

  if array_length(v_definer, 1) > 0 then
    raise exception 'FALHA: função do painel é security definer (ignora RLS): %', v_definer;
  end if;

  -- `anon` é o role da chave que vai no bundle do navegador. Função nova
  -- nasce com execute para PUBLIC, que o inclui.
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_anon
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'painel\_%'
    and has_function_privilege('anon', p.oid, 'execute');

  if array_length(v_anon, 1) > 0 then
    raise exception 'FALHA: anon executa consulta do painel: %', v_anon;
  end if;

  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_frouxas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and not coalesce(
      (select option_value = 'true'
         from pg_options_to_table(c.reloptions)
        where option_name = 'security_invoker'),
      false
    );

  if array_length(v_frouxas, 1) > 0 then
    raise exception 'FALHA: view sem security_invoker (ignora RLS): %', v_frouxas;
  end if;

  raise notice 'OK 8/9 · Consultas do painel respeitam a RLS de quem chama';
end;
$$;

-- 9) a retenção zera o que deve e NÃO apaga linha ----------------------------
-- A linha é o histórico de conversão e de ROAS. Apagá-la reescreveria o
-- passado do faturamento — e o painel de um mês atrás mudaria sozinho.
do $$
declare
  v_id    uuid;
  v_antes bigint;
  v_n     bigint;
begin
  select count(*) into v_antes from public.events_log;

  insert into public.events_log
    (event_id, event_name, utm_source, geo_country, payload_meta, response_meta, created_at)
  values
    ('retencao-teste', 'PageView', 'facebook', 'BR',
     '{"a":1}'::jsonb, '{"b":2}'::jsonb, now() - interval '20 days')
  returning id into v_id;

  perform private.aplicar_retencao(100);

  -- Campos pesados zerados…
  select count(*) into v_n
    from public.events_log
   where id = v_id
     and payload_meta is null
     and response_meta is null
     and purged_at is not null;
  if v_n <> 1 then
    raise exception 'FALHA: a retenção não zerou o payload';
  end if;

  -- …e o que alimenta o painel intacto.
  select count(*) into v_n
    from public.events_log
   where id = v_id
     and event_name = 'PageView'
     and utm_source = 'facebook'
     and geo_country = 'BR';
  if v_n <> 1 then
    raise exception 'FALHA: a retenção apagou dado que o painel usa';
  end if;

  -- Nenhuma linha some.
  if (select count(*) from public.events_log) <> v_antes + 1 then
    raise exception 'FALHA: a retenção apagou linha';
  end if;

  -- Linha nova não é tocada: o prazo é de 14 dias.
  insert into public.events_log (event_id, event_name, payload_meta)
  values ('retencao-recente', 'PageView', '{"a":1}'::jsonb);

  perform private.aplicar_retencao(100);

  if (select payload_meta from public.events_log where event_id = 'retencao-recente') is null then
    raise exception 'FALHA: a retenção zerou evento dentro do prazo';
  end if;

  delete from public.events_log where event_id in ('retencao-teste', 'retencao-recente');

  raise notice 'OK 9/9 · Retenção zera o payload e preserva a linha';
end;
$$;
