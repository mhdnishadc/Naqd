-- Rename the workspace (the business name shown on statements and ledger PDFs).
-- Only the owner may rename it; the old and new names are kept in the audit log.
create function rename_workspace(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); new_name text := trim(coalesce(p_name, '')); old_name text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Only the workspace owner can rename it' using errcode = '42501';
  end if;
  if new_name = '' then raise exception 'Business name is required'; end if;
  if length(new_name) > 120 then raise exception 'Business name is too long'; end if;

  select name into old_name from tenants where id = t for update;
  if old_name = new_name then return; end if;

  update tenants set name = new_name where id = t;
  insert into audit_log (tenant_id, table_name, row_id, action, actor, data)
  values (t, 'tenants', t, 'UPDATE', auth.uid(), jsonb_build_object('old_name', old_name, 'name', new_name));
end $$;

revoke execute on function rename_workspace(text) from public, anon;
grant execute on function rename_workspace(text) to authenticated;
