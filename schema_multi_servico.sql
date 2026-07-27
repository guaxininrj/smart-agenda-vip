-- Permite escolher mais de um serviço no mesmo agendamento (carrinho, com "+").
-- agendamentos.valor / duracao_min passam a ser a SOMA dos serviços escolhidos.
-- agendamentos.servico_id continua preenchido com o primeiro serviço (compatibilidade),
-- mas a lista completa fica em agendamento_servicos.

create table if not exists agendamento_servicos (
  agendamento_id uuid not null references agendamentos(id) on delete cascade,
  servico_id uuid not null references servicos(id) on delete restrict,
  preco numeric(10,2) not null,
  primary key (agendamento_id, servico_id)
);

alter table agendamento_servicos enable row level security;

drop policy if exists "agendamento_servicos_dono" on agendamento_servicos;
create policy "agendamento_servicos_dono" on agendamento_servicos for all
  using (agendamento_id in (select id from agendamentos where owner_id = auth.uid()))
  with check (agendamento_id in (select id from agendamentos where owner_id = auth.uid()));

-- visitante pode registrar os serviços do agendamento público que acabou de criar,
-- desde que o serviço pertença à mesma barbearia do agendamento
drop policy if exists "agendamento_servicos_publico_insere" on agendamento_servicos;
create policy "agendamento_servicos_publico_insere" on agendamento_servicos for insert
  with check (
    exists (
      select 1 from agendamentos a
      join servicos s on s.owner_id = a.owner_id
      where a.id = agendamento_servicos.agendamento_id
        and s.id = agendamento_servicos.servico_id
    )
  );
