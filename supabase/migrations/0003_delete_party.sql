-- Delete a client / employee / funder / vendor that was added by mistake.
-- Only allowed while nothing points at it (not even voided entries): history must stay intact.
-- Parties with entries can only be hidden (active = false).
create function delete_party(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); p parties%rowtype;
begin
  select * into p from parties where id = p_id and tenant_id = t for update;
  if not found then raise exception 'Not found'; end if;

  if exists (select 1 from ledger_entries where party_id = p_id)
     or exists (select 1 from purchases where client_id = p_id)
     or exists (select 1 from collections where client_id = p_id) then
    raise exception 'This name has entries, so it cannot be deleted. Hide it instead.';
  end if;

  insert into audit_log (tenant_id, table_name, row_id, action, actor, data)
  values (t, 'parties', p_id, 'DELETE', auth.uid(), to_jsonb(p));
  delete from parties where id = p_id;
end $$;

revoke execute on function delete_party(uuid) from public, anon;
grant execute on function delete_party(uuid) to authenticated;
