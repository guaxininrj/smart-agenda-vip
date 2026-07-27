-- Aprovação manual de acesso: toda barbearia nova entra bloqueada até o
-- pagamento ser confirmado manualmente. Depois de liberada, o primeiro
-- login cai direto em Configurações (ainda não configurado).

alter table perfis add column if not exists liberado boolean not null default false;
alter table perfis add column if not exists configurado boolean not null default false;

-- a conta real que já está em uso (Brandão Barber) fica liberada
update perfis set liberado = true where nome_barbearia = 'BRANDÃO BARBER';
