-- Testes de isolamento entre contas (RLS) — Barber Book / Smart Agenda VIP
--
-- Recria em SQL o exato cenário do bug encontrado em 2026-07-23: a barbearia
-- "SMART LINK DIGITAL" (conta de teste) enxergava o barbeiro e os serviços da
-- "BARBEARIA DO GALERÃO" no próprio painel, porque as políticas *_publico
-- (barbeiros/servicos/produtos/planos/perfis) valiam pra {public} em vez de
-- só {anon}. Se algum dia alguém recriar essa política errada de novo (ex:
-- copiando o padrão pra uma tabela nova), este teste falha na hora.
--
-- Cria SUAS PRÓPRIAS linhas de teste (marcadas com o prefixo '__teste_rls__')
-- em vez de contar linhas reais das contas — contas de produção mudam o
-- tempo todo (novos barbeiros, produtos etc.), então o teste não pode
-- depender de "quantas linhas existem hoje", só de "dono B nunca vê a linha
-- de teste que só o dono A criou". Sempre limpa as próprias linhas no final.
--
-- Como rodar: npx supabase db query --linked --file tests/rls_isolamento.sql
-- (a partir de BARBER BOOK/site). Escreve e apaga linhas de teste na conta
-- da Barbearia do Galerão — seguro rodar em produção, não deixa rastro.

do $$
declare
  v_dono_a uuid := '682fb483-86a9-45f2-8419-dea48acc2582'; -- Barbearia do Galerão
  v_dono_b uuid := 'eacba5de-27f9-473c-b522-5229c7d374d6'; -- Smart Link Digital (conta de teste)
  v_barbeiro_id uuid;
  v_produto_id uuid;
  v_plano_id uuid;
  v_servico_id uuid;
  v_qtd int;
  v_falhas int := 0;
begin
  -------------------------------------------------------------------------
  -- 0) Cria 1 linha de teste de cada tipo, todas pertencendo ao Dono A
  -------------------------------------------------------------------------
  insert into barbeiros (owner_id, nome, comissao_pct, ativo)
  values (v_dono_a, '__teste_rls__', 0, true) returning id into v_barbeiro_id;

  insert into servicos (owner_id, nome, preco, duracao_min, ativo)
  values (v_dono_a, '__teste_rls__', 1, 10, true) returning id into v_servico_id;

  insert into produtos (owner_id, nome, preco, ativo, barbeiro_id)
  values (v_dono_a, '__teste_rls__', 1, true, v_barbeiro_id) returning id into v_produto_id;

  insert into planos (owner_id, nome, preco, ativo, barbeiro_id)
  values (v_dono_a, '__teste_rls__', 1, true, v_barbeiro_id) returning id into v_plano_id;

  -------------------------------------------------------------------------
  -- 1) Dono B, autenticado, NÃO pode ver as linhas de teste do Dono A
  -------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_dono_b::text, true);

  select count(*) into v_qtd from barbeiros where id = v_barbeiro_id;
  if v_qtd <> 0 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: Dono B enxergou o barbeiro de teste do Dono A — vazamento entre contas!';
  else
    raise notice 'OK: Dono B não vê o barbeiro de teste de outra barbearia';
  end if;

  select count(*) into v_qtd from produtos where id = v_produto_id;
  if v_qtd <> 0 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: Dono B enxergou o produto de teste do Dono A!';
  else
    raise notice 'OK: Dono B não vê o produto de teste de outra barbearia';
  end if;

  select count(*) into v_qtd from planos where id = v_plano_id;
  if v_qtd <> 0 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: Dono B enxergou o plano de teste do Dono A!';
  else
    raise notice 'OK: Dono B não vê o plano de teste de outra barbearia';
  end if;

  select count(*) into v_qtd from servicos where id = v_servico_id;
  if v_qtd <> 0 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: Dono B enxergou o serviço de teste do Dono A!';
  else
    raise notice 'OK: Dono B não vê o serviço de teste de outra barbearia';
  end if;

  -- perfis: Dono B só pode ver a própria linha, nunca a lista inteira de barbearias
  select count(*) into v_qtd from perfis;
  if v_qtd <> 1 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: Dono B autenticado enxergou % perfis (esperado: 1, só o dele)', v_qtd;
  else
    raise notice 'OK: Dono B só vê o próprio perfil (1 linha)';
  end if;

  -------------------------------------------------------------------------
  -- 2) Dono A ainda enxerga as PRÓPRIAS linhas de teste normalmente
  -------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_dono_a::text, true);

  select count(*) into v_qtd from barbeiros where id = v_barbeiro_id;
  if v_qtd <> 1 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: Dono A não conseguiu ver a própria linha de teste (RLS bloqueou o próprio dono)';
  else
    raise notice 'OK: Dono A continua vendo os próprios dados';
  end if;

  -------------------------------------------------------------------------
  -- 3) Visitante anônimo (página pública) vê a linha de teste, marcada ativa
  -------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_qtd from barbeiros where id = v_barbeiro_id;
  if v_qtd <> 1 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: anon deveria ver o barbeiro de teste (ativo=true, catálogo público) e não viu';
  else
    raise notice 'OK: anon ainda vê barbeiros ativos pro agendamento público';
  end if;

  select count(*) into v_qtd from perfis where id = v_dono_a;
  if v_qtd <> 1 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: anon deveria conseguir achar o perfil público do Dono A e não achou';
  else
    raise notice 'OK: anon ainda consegue achar a página pública por perfil';
  end if;

  -- colunas sensíveis de perfis não podem estar liberadas pra anon
  begin
    perform liberado from perfis limit 1;
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: anon conseguiu ler a coluna perfis.liberado (deveria dar erro de permissão)';
  exception when insufficient_privilege then
    raise notice 'OK: anon não consegue ler perfis.liberado (permissão de coluna intacta)';
  end;

  -------------------------------------------------------------------------
  -- limpeza: apaga as linhas de teste antes de decidir passou/falhou
  -------------------------------------------------------------------------
  reset role;
  delete from produtos where id = v_produto_id;
  delete from planos where id = v_plano_id;
  delete from servicos where id = v_servico_id;
  delete from barbeiros where id = v_barbeiro_id;

  if v_falhas > 0 then
    raise exception '% teste(s) de isolamento FALHARAM — veja os warnings acima', v_falhas;
  end if;
  raise notice '✅ Todos os testes de isolamento entre contas passaram.';
end $$;
