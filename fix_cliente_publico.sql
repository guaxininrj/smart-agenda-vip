-- Insert direto + RETURNING como anon esbarra numa regra do Postgres: a linha
-- inserida também precisa passar por uma policy de SELECT, e não queremos
-- expor nome/telefone de todos os clientes publicamente. Solução: uma função
-- security definer que faz o find-or-create por dentro, sem depender de RLS
-- na leitura, e sem expor a tabela inteira.

drop policy if exists "clientes_publico_insere" on clientes;

create or replace function public.obter_ou_criar_cliente(p_owner_id uuid, p_nome text, p_telefone text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from perfis where id = p_owner_id) then
    raise exception 'barbearia inválida';
  end if;

  select id into v_id from clientes where owner_id = p_owner_id and telefone = p_telefone limit 1;
  if v_id is null then
    insert into clientes (owner_id, nome, telefone) values (p_owner_id, p_nome, p_telefone) returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.obter_ou_criar_cliente(uuid, text, text) to anon, authenticated;
