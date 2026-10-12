-- =====================================================================
-- Vendor refunds (purchase returns)
-- A product bought for a client goes back to the vendor and the vendor pays cash back.
--   * cash in hand goes UP by the refund        (ledger kind 'vendor_refund', direction 'in')
--   * the client's bill goes DOWN by the credit (statement, receivables, aging)
--   * sales / cost / gross profit drop in the month of the return
-- Partial returns are allowed; several returns per purchase are allowed.
--
-- Safety: this migration ADDS a table and a function and widens two CHECK constraints so the
-- new kind is accepted. No existing row is changed. Read models are replaced with versions that
-- give identical results when there are no returns.
-- =====================================================================

create table purchase_returns (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  purchase_id uuid not null references purchases(id),
  client_id   uuid not null references parties(id),
  return_date date not null default current_date,
  refund      bigint not null check (refund > 0),   -- cash back from the vendor (cost side)
  credit      bigint not null check (credit >= 0),  -- taken off the client's bill (selling side)
  ledger_id   uuid references ledger_entries(id),
  note        text,
  client_ref  uuid,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz
);
create unique index purchase_returns_ref_uq on purchase_returns (tenant_id, client_ref) where client_ref is not null;
create index purchase_returns_purchase on purchase_returns (purchase_id);
create index purchase_returns_client on purchase_returns (tenant_id, client_id, return_date);

alter table purchase_returns enable row level security;
create policy returns_read on purchase_returns for select using (tenant_id = current_tenant());
revoke all on purchase_returns from public, anon, authenticated;
grant select on purchase_returns to authenticated;
create trigger audit_returns after insert or update on purchase_returns for each row execute function audit_trigger();

-- ---------- allow the new ledger kind ----------
-- The two CHECKs that list kinds were created unnamed; find them by content and recreate them.
do $$ declare c record; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.ledger_entries'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%bank_withdrawal%'
  loop execute format('alter table ledger_entries drop constraint %I', c.conname); end loop;
end $$;
alter table ledger_entries add constraint ledger_entries_kind_check check (kind in
  ('bank_withdrawal','topup','employee_return','collection','vendor_refund',
   'purchase','advance','advance_expense','fuel','transport','expense'));
alter table ledger_entries add constraint ledger_entries_kind_direction_check check (
     (kind in ('bank_withdrawal','topup','employee_return','collection','vendor_refund') and direction = 'in')
  or (kind in ('purchase','advance','advance_expense','fuel','transport','expense') and direction = 'out'));

-- ---------- record a return ----------
-- p_credit null = automatic: the whole remaining bill for a full return, otherwise the same share as the refund.
create function record_purchase_return(
  p_ref uuid, p_date date, p_purchase uuid, p_refund bigint,
  p_credit bigint default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); pu purchases%rowtype; refunded bigint; credited bigint;
        left_cost bigint; left_sell bigint; d date := coalesce(p_date, current_date); lid uuid; rid uuid;
begin
  if p_ref is not null then
    select id into rid from purchase_returns where tenant_id = t and client_ref = p_ref;
    if found then return rid; end if;
  end if;

  -- lock the purchase so two returns at once cannot both pass the limits below
  select * into pu from purchases where id = p_purchase and tenant_id = t for update;
  if not found then raise exception 'Purchase not found'; end if;
  if pu.voided_at is not null then raise exception 'This purchase was voided'; end if;
  if d < pu.purchase_date then raise exception 'A return cannot be dated before the purchase (%)', pu.purchase_date; end if;

  select coalesce(sum(refund), 0), coalesce(sum(credit), 0) into refunded, credited
    from purchase_returns where purchase_id = p_purchase and voided_at is null;
  left_cost := pu.cost - refunded;
  left_sell := pu.sell - credited;

  if p_refund is null or p_refund <= 0 then raise exception 'Refund must be greater than zero'; end if;
  if left_cost <= 0 then raise exception 'This purchase has already been fully refunded'; end if;
  if p_refund > left_cost then
    raise exception 'Refund is more than what is left to refund (% SAR)', to_char(left_cost / 100.0, 'FM999,999,990.00');
  end if;

  if p_credit is null then
    p_credit := case when p_refund = left_cost then left_sell
                     else least(left_sell, round(p_refund::numeric * pu.sell / pu.cost)::bigint) end;
  end if;
  if p_credit < 0 then raise exception 'Bill reduction cannot be negative'; end if;
  if p_credit > left_sell then
    raise exception 'Bill reduction is more than what is left on the client''s bill (% SAR)', to_char(left_sell / 100.0, 'FM999,999,990.00');
  end if;

  insert into ledger_entries (tenant_id, entry_date, kind, direction, amount, party_id, note, client_ref)
  values (t, d, 'vendor_refund', 'in', p_refund, pu.client_id,
          coalesce(nullif(trim(p_note), ''), pu.description), p_ref)
  returning id into lid;

  insert into purchase_returns (tenant_id, purchase_id, client_id, return_date, refund, credit, ledger_id, note, client_ref)
  values (t, p_purchase, pu.client_id, d, p_refund, p_credit, lid, nullif(trim(p_note), ''), p_ref)
  returning id into rid;
  return rid;
end $$;

-- ---------- voiding ----------
-- Voiding a refund voids its return. A purchase with live returns cannot be voided until they are.
create or replace function void_ledger_entry(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); e ledger_entries%rowtype;
begin
  select * into e from ledger_entries where id = p_id and tenant_id = t for update;
  if not found then raise exception 'Entry not found'; end if;
  if e.voided_at is not null then return; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Give a reason for voiding'; end if;

  if e.kind = 'purchase' and exists (
       select 1 from purchase_returns r join purchases p on p.id = r.purchase_id
        where p.ledger_id = p_id and r.voided_at is null) then
    raise exception 'This purchase has vendor refunds. Void the refunds first.';
  end if;

  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_id;
  if e.kind = 'purchase' then
    update purchases set voided_at = now() where ledger_id = p_id and tenant_id = t;
  elsif e.kind = 'collection' then
    update collections set voided_at = now() where ledger_id = p_id and tenant_id = t;
  elsif e.kind = 'vendor_refund' then
    update purchase_returns set voided_at = now() where ledger_id = p_id and tenant_id = t;
  end if;
end $$;

-- ---------- read models: net of returns ----------
create or replace view v_client_balances with (security_invoker = true) as
select p.id as party_id, p.tenant_id, p.name, p.phone, p.active,
       (coalesce((select sum(sell)   from purchases        x where x.client_id = p.id and x.voided_at is null), 0)
      - coalesce((select sum(credit) from purchase_returns x where x.client_id = p.id and x.voided_at is null), 0))::bigint as billed,
       coalesce((select sum(amount) from collections x where x.client_id = p.id and x.voided_at is null), 0)::bigint as collected
from parties p where p.type = 'client';

-- oldest purchases are treated as paid first (FIFO); each purchase counts net of its returns
create or replace view v_open_purchases with (security_invoker = true) as
with net as (
  select p.id, p.tenant_id, p.client_id, p.purchase_date, p.description, p.created_at,
         (p.sell - coalesce((select sum(r.credit) from purchase_returns r
                              where r.purchase_id = p.id and r.voided_at is null), 0))::bigint as sell
  from purchases p where p.voided_at is null
), s as (
  select net.*, sum(net.sell) over (partition by net.client_id order by net.purchase_date, net.created_at, net.id) as cum
  from net
), paid as (
  select client_id, sum(amount) as total from collections where voided_at is null group by client_id
)
select s.id, s.tenant_id, s.client_id, s.purchase_date, s.description, s.sell,
       least(s.sell, greatest(0, s.cum - coalesce(paid.total, 0)))::bigint as outstanding,
       (current_date - s.purchase_date) as age_days
from s left join paid on paid.client_id = s.client_id
where least(s.sell, greatest(0, s.cum - coalesce(paid.total, 0))) > 0;

create or replace function _dashboard_summary(t uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; ret_credit bigint; ret_refund bigint;
begin
  select coalesce(sum(credit), 0), coalesce(sum(refund), 0) into ret_credit, ret_refund
    from purchase_returns where tenant_id = t and voided_at is null and return_date between p_from and p_to;

  select jsonb_build_object(
    'cash_in_hand', coalesce((select sum(case direction when 'in' then amount else -amount end)
                              from ledger_entries where tenant_id = t and affects_cash and voided_at is null), 0),
    'receivables',  coalesce((select sum(billed - collected) from v_client_balances where tenant_id = t), 0),
    'with_employees', coalesce((select sum(advanced - returned - spent) from v_employee_balances where tenant_id = t), 0),
    'sales',    coalesce((select sum(sell)   from purchases where tenant_id = t and voided_at is null and purchase_date between p_from and p_to), 0) - ret_credit,
    'cost',     coalesce((select sum(cost)   from purchases where tenant_id = t and voided_at is null and purchase_date between p_from and p_to), 0) - ret_refund,
    'gross_profit', coalesce((select sum(profit) from purchases where tenant_id = t and voided_at is null and purchase_date between p_from and p_to), 0) - (ret_credit - ret_refund),
    'fuel',      coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'fuel'      and entry_date between p_from and p_to), 0),
    'transport', coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'transport' and entry_date between p_from and p_to), 0),
    'other_expenses', coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind in ('expense','advance_expense') and entry_date between p_from and p_to), 0),
    'withdrawn', coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'bank_withdrawal' and entry_date between p_from and p_to), 0),
    'topups',    coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'topup' and entry_date between p_from and p_to), 0),
    'collected', coalesce((select sum(amount) from collections where tenant_id = t and voided_at is null and collection_date between p_from and p_to), 0),
    'vendor_refunds', ret_refund
  ) into r;
  return r || jsonb_build_object('net_profit',
      (r->>'gross_profit')::bigint - (r->>'fuel')::bigint - (r->>'transport')::bigint - (r->>'other_expenses')::bigint);
end $$;

-- Statement shows SELLING prices only: a return appears as a credit, never with the vendor refund.
create or replace function _client_statement(t uuid, p_client uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
        opening bigint; pur jsonb; ret jsonb; col jsonb; ptotal bigint; rtotal bigint; ctotal bigint; cname text;
begin
  select name into cname from parties where id = p_client and tenant_id = t and type = 'client';
  if cname is null then raise exception 'Client not found'; end if;

  select coalesce((select sum(sell) from purchases where tenant_id = t and client_id = p_client and voided_at is null and purchase_date < m0), 0)
       - coalesce((select sum(credit) from purchase_returns where tenant_id = t and client_id = p_client and voided_at is null and return_date < m0), 0)
       - coalesce((select sum(amount) from collections where tenant_id = t and client_id = p_client and voided_at is null and collection_date < m0), 0)
    into opening;

  select coalesce(jsonb_agg(jsonb_build_object('date', purchase_date, 'description', description, 'amount', sell) order by purchase_date, created_at), '[]'::jsonb),
         coalesce(sum(sell), 0)
    into pur, ptotal
    from purchases where tenant_id = t and client_id = p_client and voided_at is null and purchase_date >= m0 and purchase_date < m1;

  select coalesce(jsonb_agg(jsonb_build_object('date', r.return_date, 'description', p.description, 'amount', r.credit) order by r.return_date, r.created_at), '[]'::jsonb),
         coalesce(sum(r.credit), 0)
    into ret, rtotal
    from purchase_returns r join purchases p on p.id = r.purchase_id
   where r.tenant_id = t and r.client_id = p_client and r.voided_at is null and r.credit > 0
     and r.return_date >= m0 and r.return_date < m1;

  select coalesce(jsonb_agg(jsonb_build_object('date', collection_date, 'mode', mode, 'amount', amount) order by collection_date, created_at), '[]'::jsonb),
         coalesce(sum(amount), 0)
    into col, ctotal
    from collections where tenant_id = t and client_id = p_client and voided_at is null and collection_date >= m0 and collection_date < m1;

  return jsonb_build_object('client', cname, 'month', m0, 'opening', opening,
           'purchases', pur, 'purchases_total', ptotal,
           'returns', ret, 'returns_total', rtotal,
           'collections', col, 'collections_total', ctotal,
           'closing', opening + ptotal - rtotal - ctotal);
end $$;

-- ---------- privileges ----------
revoke execute on function record_purchase_return(uuid, date, uuid, bigint, bigint, text) from public, anon;
grant execute on function record_purchase_return(uuid, date, uuid, bigint, bigint, text) to authenticated;
