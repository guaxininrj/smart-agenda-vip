-- Barber Book — schema multi-tenant
-- Cada barbearia = 1 conta (auth.users). Todas as tabelas isolam por owner_id via RLS.

create table perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_barbearia text not null,
  telefone text,
  endereco text,
  logo_url text,
  criado_em timestamptz not null default now()
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  telefone text,
  observacoes text,
  criado_em timestamptz not null default now()
);

create table barbeiros (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  telefone text,
  comissao_pct numeric(5,2) not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table servicos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  preco numeric(10,2) not null,
  duracao_min integer not null default 30,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table agendamentos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete set null,
  barbeiro_id uuid references barbeiros(id) on delete set null,
  servico_id uuid references servicos(id) on delete set null,
  data_hora timestamptz not null,
  status text not null default 'agendado' check (status in ('agendado','concluido','cancelado')),
  valor numeric(10,2),
  criado_em timestamptz not null default now()
);

create table despesas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  descricao text not null,
  valor numeric(10,2) not null,
  data date not null default current_date,
  criado_em timestamptz not null default now()
);

-- indices
create index on clientes (owner_id);
create index on barbeiros (owner_id);
create index on servicos (owner_id);
create index on agendamentos (owner_id);
create index on agendamentos (owner_id, data_hora);
create index on despesas (owner_id);

-- RLS
alter table perfis enable row level security;
alter table clientes enable row level security;
alter table barbeiros enable row level security;
alter table servicos enable row level security;
alter table agendamentos enable row level security;
alter table despesas enable row level security;

create policy "perfis_dono" on perfis
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "clientes_dono" on clientes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "barbeiros_dono" on barbeiros
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "servicos_dono" on servicos
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "agendamentos_dono" on agendamentos
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "despesas_dono" on despesas
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- cria o perfil automaticamente quando alguem se cadastra
create function public.criar_perfil_novo_usuario()
returns trigger as $$
begin
  insert into public.perfis (id, nome_barbearia)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome_barbearia', 'Minha Barbearia'));
  return new;
end;
$$ language plpgsql security definer;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute procedure public.criar_perfil_novo_usuario();
