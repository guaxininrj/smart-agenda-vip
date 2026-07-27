-- Teste da lógica do Financeiro — Barber Book / Smart Agenda VIP
--
-- Recria o bug corrigido em 2026-07-23: o botão "Excluir" do Financeiro
-- limpava agendamentos.concluido_em, mas a consulta de entradas filtrava
-- por data_hora (data agendada), não por concluido_em (data que realmente
-- virou dinheiro) — então limpar o campo não tirava a linha da lista.
-- Este teste prova que a janela do mês usa concluido_em, replicando
-- exatamente a query de index.html > renderFinanceiro().
--
-- Como rodar: npx supabase db query --linked --file tests/financeiro_logica.sql
-- Cria e apaga 2 linhas de teste na conta da Barbearia do Galerão — seguro
-- rodar em produção, não deixa rastro.

do $$
declare
  v_dono uuid := '682fb483-86a9-45f2-8419-dea48acc2582'; -- Barbearia do Galerão
  v_id_dentro uuid;
  v_id_fora uuid;
  v_mes_atual text := to_char(now(), 'YYYY-MM');
  v_inicio timestamptz := (v_mes_atual || '-01')::timestamptz;
  v_fim timestamptz := (v_inicio + interval '1 month' - interval '1 second');
  v_conta_dentro int;
  v_conta_fora int;
  v_falhas int := 0;
begin
  -- linha A: agendada há 2 meses, mas CONCLUÍDA/PAGA este mês -> deve contar
  insert into agendamentos (owner_id, data_hora, status, valor, concluido_em, pago)
  values (v_dono, now() - interval '2 months', 'concluido', 37.50, now(), true)
  returning id into v_id_dentro;

  -- linha B: agendada hoje, mas concluída/paga há 2 meses -> NÃO deve contar
  insert into agendamentos (owner_id, data_hora, status, valor, concluido_em, pago)
  values (v_dono, now(), 'concluido', 999.99, now() - interval '2 months', true)
  returning id into v_id_fora;

  -- réplica exata da query de renderFinanceiro() em index.html
  select count(*) into v_conta_dentro
  from agendamentos
  where owner_id = v_dono and status = 'concluido'
    and concluido_em >= v_inicio and concluido_em <= v_fim
    and id = v_id_dentro;

  select count(*) into v_conta_fora
  from agendamentos
  where owner_id = v_dono and status = 'concluido'
    and concluido_em >= v_inicio and concluido_em <= v_fim
    and id = v_id_fora;

  -- limpa antes de decidir passou/falhou, pra não deixar lixo mesmo se falhar
  delete from agendamentos where id in (v_id_dentro, v_id_fora);

  if v_conta_dentro <> 1 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: agendamento concluído ESTE mês (mas agendado há 2 meses) não apareceu no Financeiro do mês';
  else
    raise notice 'OK: Financeiro conta pela data de conclusão, não pela data agendada (entrada dentro)';
  end if;

  if v_conta_fora <> 0 then
    v_falhas := v_falhas + 1;
    raise warning 'FALHOU: agendamento concluído há 2 meses (mas agendado hoje) apareceu no Financeiro deste mês';
  else
    raise notice 'OK: agendamento concluído em outro mês não vaza pro Financeiro deste mês (entrada fora)';
  end if;

  if v_falhas > 0 then
    raise exception '% teste(s) da lógica do Financeiro FALHARAM', v_falhas;
  end if;
  raise notice '✅ Lógica do Financeiro (janela por concluido_em) confirmada.';
end $$;
