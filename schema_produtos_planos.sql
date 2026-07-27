-- Produtos (itens avulsos, sem agendamento) e Planos (assinatura mensal),
-- pra aparecer na página pública igual ao BarberBook de referência.

create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  preco numeric(10,2) not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists planos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  badge text,
  descricao text,
  preco numeric(10,2) not null,
  servicos_inclusos jsonb not null default '[]'::jsonb,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table produtos enable row level security;
alter table planos enable row level security;

create policy "produtos_dono" on produtos for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "produtos_publico" on produtos for select using (ativo = true);

create policy "planos_dono" on planos for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "planos_publico" on planos for select using (ativo = true);
