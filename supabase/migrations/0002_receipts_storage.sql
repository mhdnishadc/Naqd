-- Private bucket for receipt photos. Files live under <tenant_id>/<entry-ref>.jpg
-- and each workspace can only read/write its own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_tenant()::text);

create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_tenant()::text);

-- upsert (retry after a flaky upload) needs update on the same folder
create policy receipts_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_tenant()::text);
-- No delete policy on purpose: receipts are evidence and are never removed from the app.
