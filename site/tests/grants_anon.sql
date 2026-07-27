-- Teste de grants do papel "anon" — Barber Book / Smart Agenda VIP
--
-- Recria o achado de 2026-07-24: várias tabelas tinham grants de
-- INSERT/UPDATE/DELETE liberados pra "anon" mesmo sem nenhuma política de
-- RLS que realmente permitisse isso (só "seguro" porque auth.uid() é NULL
-- pra anon, o que bloqueia os checks de owner_id). Isso é frágil — um dia
-- alguém pode adicionar uma política nova sem perceber que o grant já
-- estava aberto. Este teste garante que "anon" só tem exatamente o que
-- realmente usa: SELECT nas tabelas públicas e INSERT em agendamentos.
--
-- Como rodar: npx supabase db query --linked --file tests/grants_anon.sql
-- Só leitura de catálogo (information_schema), não mexe em dado nenhum.

do $$
declare
  v_tabela text;
  v_falhas int := 0;
  v_qtd int;
  -- tabelas onde "anon" NÃO deveria ter INSERT/UPDATE/DELETE em nenhuma coluna
  v_tabelas_proibidas text[] := array[
    'agendamento_servicos','assinaturas','clientes','cobrancas','despesas',
    'horarios_ocupados','lojas','pedido_itens','pedidos','pedidos_plataforma',
    'planos','produtos','servicos'
  ];
begin
  foreach v_tabela in array v_tabelas_proibidas loop
    select count(*) into v_qtd
    from information_schema.column_privileges
    where table_schema = 'public' and table_name = v_tabela
      and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE');
    if v_qtd > 0 then
      v_falhas := v_falhas + 1;
      raise warning 'FALHOU: anon tem % grant(s) de escrita em % (deveria ter 0)', v_qtd, v_tabela;
    end if;
  end loop;

  -- agendamentos é a única exceção: anon PRECISA de INSERT (agendamento
  -- público), mas nunca UPDATE/DELETE
  select count(*) into v_qtd
  from information_schema.column_privileges
  where table_schema='public' and table_name='agendamentos'
    and grantee='anon' and privilege_type in ('UPDATE','DELETE');
  if v_qtd > 0 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: anon tem % grant(s) de UPDATE/DELETE em agendamentos (deveria ter 0)', v_qtd;
  else
    raise notice 'OK: anon sem UPDATE/DELETE em agendamentos';
  end if;

  select count(*) into v_qtd
  from information_schema.column_privileges
  where table_schema='public' and table_name='agendamentos'
    and grantee='anon' and privilege_type='INSERT';
  if v_qtd = 0 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: anon perdeu o INSERT em agendamentos (agendamento público vai quebrar)';
  else
    raise notice 'OK: anon ainda consegue inserir agendamentos (agendamento público)';
  end if;

  if v_falhas > 0 then
    raise exception '% problema(s) de grants encontrados — veja os warnings acima', v_falhas;
  end if;
  raise notice '✅ Grants de anon estão no mínimo necessário.';
end $$;
