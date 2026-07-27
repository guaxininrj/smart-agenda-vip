-- Mesma classe de problema do obter_ou_criar_cliente: a policy pública de
-- agendamento_servicos depende de enxergar a linha em "agendamentos" pra
-- validar o dono, mas o anon não tem policy de SELECT em agendamentos
-- (só INSERT), então o EXISTS(...) sempre dá falso. Resolve com uma função
-- security definer, que já valida por dentro sem depender de RLS de leitura.

drop policy if exists "agendamento_servicos_publico_insere" on agendamento_servicos;

create or replace function public.registrar_servicos_agendamento(p_agendamento_id uuid, p_itens jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_owner uuid;
  item jsonb;
begin
  select owner_id into v_owner from agendamentos where id = p_agendamento_id;
  if v_owner is null then
    raise exception 'agendamento inválido';
  end if;

  for item in select * from jsonb_array_elements(p_itens)
  loop
    if not exists (select 1 from servicos where id = (item->>'servico_id')::uuid and owner_id = v_owner) then
      raise exception 'serviço inválido para essa barbearia';
    end if;
    insert into agendamento_servicos (agendamento_id, servico_id, preco)
    values (p_agendamento_id, (item->>'servico_id')::uuid, (item->>'preco')::numeric);
  end loop;
end;
$$;

grant execute on function public.registrar_servicos_agendamento(uuid, jsonb) to anon, authenticated;
