-- Barber Book — página pública de agendamento (slug, horários, disponibilidade)

create extension if not exists unaccent;
create extension if not exists btree_gist;

-- slug + configurações públicas da barbearia
alter table perfis add column if not exists slug text unique;
alter table perfis add column if not exists horarios jsonb not null default '{}'::jsonb;
alter table perfis add column if not exists whatsapp text;
alter table perfis add column if not exists instagram text;
alter table perfis add column if not exists facebook text;
alter table perfis add column if not exists sobre text;

-- snapshot de duração no agendamento (igual já fazemos com valor)
alter table agendamentos add column if not exists duracao_min integer not null default 30;

-- período calculado do agendamento, usado pra travar conflito de horário
-- (timestamptz + interval não é IMMUTABLE, então não dá pra usar GENERATED ALWAYS; calculamos via trigger)
alter table agendamentos add column if not exists periodo tstzrange;

create or replace function public.calcular_periodo_agendamento()
returns trigger as $$
begin
  new.periodo := tstzrange(new.data_hora, new.data_hora + (new.duracao_min * interval '1 minute'), '[)');
  return new;
end;
$$ language plpgsql;

drop trigger if exists ao_salvar_agendamento on agendamentos;
create trigger ao_salvar_agendamento
  before insert or update on agendamentos
  for each row execute procedure public.calcular_periodo_agendamento();

-- nunca deixa dois agendamentos do mesmo barbeiro se sobreporem
alter table agendamentos drop constraint if exists sem_conflito_barbeiro;
alter table agendamentos add constraint sem_conflito_barbeiro
  exclude using gist (barbeiro_id with =, periodo with &&)
  where (status <> 'cancelado' and barbeiro_id is not null);

-- gerador de slug (remove acento, vira kebab-case, adiciona sufixo curto pra evitar colisão)
create or replace function public.gerar_slug(txt text, sufixo text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(unaccent(txt)), '[^a-z0-9]+', '-', 'g')) || '-' || sufixo
$$;

-- backfill do slug pra quem já tem conta
update perfis set slug = public.gerar_slug(nome_barbearia, substr(id::text, 1, 6))
where slug is null;

-- daqui pra frente todo cadastro novo já sai com slug
create or replace function public.criar_perfil_novo_usuario()
returns trigger as $$
begin
  insert into public.perfis (id, nome_barbearia, slug)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome_barbearia', 'Minha Barbearia'),
    public.gerar_slug(coalesce(new.raw_user_meta_data->>'nome_barbearia', 'barbearia'), substr(new.id::text, 1, 6))
  );
  return new;
end;
$$ language plpgsql security definer;

-- ==== acesso público (visitante sem login) ====

-- dados da barbearia (nome, endereço, horários, contatos) são públicos por natureza
drop policy if exists "perfis_publico" on perfis;
create policy "perfis_publico" on perfis for select using (true);

drop policy if exists "servicos_publico" on servicos;
create policy "servicos_publico" on servicos for select using (ativo = true);

drop policy if exists "barbeiros_publico" on barbeiros;
create policy "barbeiros_publico" on barbeiros for select using (ativo = true);

-- view enxuta só com o necessário pra calcular horário livre (sem expor cliente/valor)
create or replace view public.horarios_ocupados as
select owner_id, barbeiro_id, data_hora, duracao_min
from public.agendamentos
where status <> 'cancelado';

grant select on public.horarios_ocupados to anon, authenticated;

-- visitante pode criar um cliente (lead) e um agendamento pra uma barbearia existente
drop policy if exists "clientes_publico_insere" on clientes;
create policy "clientes_publico_insere" on clientes for insert
  with check (owner_id in (select id from perfis));

drop policy if exists "agendamentos_publico_insere" on agendamentos;
create policy "agendamentos_publico_insere" on agendamentos for insert
  with check (
    status = 'agendado'
    and owner_id in (select id from perfis)
    and servico_id in (select id from servicos where owner_id = agendamentos.owner_id and ativo = true)
    and barbeiro_id in (select id from barbeiros where owner_id = agendamentos.owner_id and ativo = true)
  );
