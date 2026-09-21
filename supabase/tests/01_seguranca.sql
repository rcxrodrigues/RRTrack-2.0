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
  raise notice 'OK 1/7 · RLS ligada em todas as tabelas';
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
  raise notice 'OK 2/7 · Nenhuma policy de escrita — só service_role grava';
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
  raise notice 'OK 3/7 · Ponteiros para o cofre fora do alcance do painel';
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
  raise notice 'OK 4/7 · Funções de segredo só para o service_role';
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
    raise notice 'OK 5/7 · Cofre: guarda, lê, atualiza sem órfão e limpa ao apagar';
    raise notice '         (substituto local — a cifra em si é do Vault, testada no Supabase)';
  else
    raise notice 'OK 5/7 · Cofre: guarda, lê, atualiza sem órfão e limpa ao apagar';
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
  raise notice 'OK 6/7 · Rate limit corta no limite e isola por bucket';
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

  raise notice 'OK 7/7 · settings trancada em uma linha';
end;
$$;
