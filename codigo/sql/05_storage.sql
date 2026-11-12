-- Fotos privadas das meninas (somente membros logados da família veem)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "familia ve fotos" on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.is_member());
create policy "pais enviam fotos" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.is_parent());
create policy "pais trocam fotos" on storage.objects for update to authenticated using (bucket_id = 'fotos' and public.is_parent());
create policy "pais apagam fotos" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and public.is_parent());
