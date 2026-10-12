-- Let the read-only shared view page through the ledger (a busy month can exceed one request).
-- Adds p_offset to share_ledger; existing callers keep working because it defaults to 0.
-- Safety: replaces one read-only function. No table or row is touched.

drop function if exists share_ledger(text, date, date, uuid, int);

create function share_ledger(p_token text, p_from date default null, p_to date default null,
                             p_party uuid default null, p_limit int default 300, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := _share_tenant(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'entry_date', l.entry_date, 'kind', l.kind, 'direction', l.direction,
             'affects_cash', l.affects_cash, 'amount', l.amount, 'party_id', l.party_id, 'note', l.note,
             'receipt_path', null, 'meta', l.meta, 'source', l.source, 'created_at', l.created_at,
             'voided_at', l.voided_at, 'void_reason', l.void_reason,
             'party', case when p.id is null then null else jsonb_build_object('name', p.name) end)
           order by l.entry_date desc, l.created_at desc, l.id desc)
    from (select * from ledger_entries
           where tenant_id = t
             and (p_from is null or entry_date >= p_from)
             and (p_to is null or entry_date <= p_to)
             and (p_party is null or party_id = p_party)
           -- id breaks ties so pages never overlap or skip rows
           order by entry_date desc, created_at desc, id desc
           limit greatest(1, least(coalesce(p_limit, 300), 1000))
           offset greatest(0, coalesce(p_offset, 0))) l
    left join parties p on p.id = l.party_id), '[]'::jsonb);
end $$;

revoke execute on function share_ledger(text, date, date, uuid, int, int) from public, anon, authenticated;
grant execute on function share_ledger(text, date, date, uuid, int, int) to anon, authenticated;
