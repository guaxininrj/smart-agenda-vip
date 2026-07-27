-- Bucket público pra guardar a foto/logo de cada barbearia.
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- cada dono só mexe na própria pasta (logos/<owner_id>/...)
drop policy if exists "logos_dono_insere" on storage.objects;
create policy "logos_dono_insere" on storage.objects for insert
  with check (bucket_id = 'logos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "logos_dono_atualiza" on storage.objects;
create policy "logos_dono_atualiza" on storage.objects for update
  using (bucket_id = 'logos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "logos_dono_remove" on storage.objects;
create policy "logos_dono_remove" on storage.objects for delete
  using (bucket_id = 'logos' and auth.uid()::text = (storage.foldername(name))[1]);

-- qualquer um pode ver (é a foto que aparece na página pública do cliente)
drop policy if exists "logos_publico_ve" on storage.objects;
create policy "logos_publico_ve" on storage.objects for select
  using (bucket_id = 'logos');
