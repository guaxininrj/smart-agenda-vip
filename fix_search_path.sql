create or replace function public.gerar_slug(txt text, sufixo text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select trim(both '-' from regexp_replace(lower(public.unaccent(txt)), '[^a-z0-9]+', '-', 'g')) || '-' || sufixo
$$;

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
$$ language plpgsql security definer set search_path = public, pg_catalog;
