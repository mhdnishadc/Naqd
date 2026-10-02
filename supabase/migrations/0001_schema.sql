-- =====================================================================
-- Naqd  |  Phase 1 + 2 schema
-- All money is stored as integer halalas (1 SAR = 100). Never floats.
-- Writes to money tables go ONLY through the RPC functions below.
-- Nothing is hard-deleted: mistakes are voided and kept in the audit log.
-- =====================================================================

-- ---------- workspace (tenant) ----------
create table tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  currency   text not null default 'SAR',
  created_at timestamptz not null default now()
);

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id),
  full_name  text,
  role       text not null default 'owner' check (role in ('owner','accountant','employee')),
  created_at timestamptz not null default now()
);

create function current_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from profiles where id = auth.uid()
$$;

-- ---------- parties ----------
create table parties (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default current_tenant() references tenants(id),
  type       text not null check (type in ('client','employee','vendor','funder')),
  name       text not null check (length(trim(name)) > 0),
  phone      text,
  aliases    text[] not null default '{}',   -- for voice matching later ("Rajhi", "الراجحي")
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, type, name)
);

-- ---------- ledger: every movement of cash (and advance settlements) ----------
create table ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  entry_date     date not null default current_date,
  kind           text not null check (kind in
                   ('bank_withdrawal','topup','employee_return','collection',
                    'purchase','advance','advance_expense','fuel','transport','expense')),
  direction      text not null check (direction in ('in','out')),
  affects_cash   boolean not null default true,
  amount         bigint not null check (amount > 0),
  party_id       uuid references parties(id),
  note           text,
  receipt_path   text,
  meta           jsonb not null default '{}',      -- vehicle, km, ...
  source         text not null default 'manual' check (source in ('manual','voice')),
  raw_transcript text,
  ai_confidence  numeric,
  client_ref     uuid,                              -- idempotency key from the device
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid,
  void_reason    text,
  check ( (kind in ('bank_withdrawal','topup','employee_return','collection') and direction = 'in')
       or (kind in ('purchase','advance','advance_expense','fuel','transport','expense') and direction = 'out') ),
  check ( affects_cash or kind in ('advance_expense') )
);
create unique index ledger_ref_uq on ledger_entries (tenant_id, client_ref) where client_ref is not null;
create index ledger_tenant_date on ledger_entries (tenant_id, entry_date desc);

-- ---------- purchases (sales to a client) ----------
create table purchases (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  client_id     uuid not null references parties(id),
  vendor_name   text,
  description   text not null check (length(trim(description)) > 0),
  cost          bigint not null check (cost >= 0),
  profit        bigint not null default 0,
  sell          bigint generated always as (cost + profit) stored,
  purchase_date date not null default current_date,
  ledger_id     uuid references ledger_entries(id),
  receipt_path  text,
  note          text,
  client_ref    uuid,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  check (cost + profit >= 0)
);
create unique index purchases_ref_uq on purchases (tenant_id, client_ref) where client_ref is not null;
create index purchases_client on purchases (tenant_id, client_id, purchase_date);

-- ---------- collections (client pays us) ----------
create table collections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  client_id       uuid not null references parties(id),
  amount          bigint not null check (amount > 0),
  mode            text not null default 'cash' check (mode in ('cash','transfer','cheque')),
  collection_date date not null default current_date,
  ledger_id       uuid references ledger_entries(id),   -- only for cash collections
  note            text,
  client_ref      uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  voided_at       timestamptz
);
create unique index collections_ref_uq on collections (tenant_id, client_ref) where client_ref is not null;
create index collections_client on collections (tenant_id, client_id, collection_date);

-- ---------- audit log ----------
create table audit_log (
  id         bigserial primary key,
  tenant_id  uuid,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  actor      uuid,
  at         timestamptz not null default now(),
  data       jsonb
);

create function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (tenant_id, table_name, row_id, action, actor, data)
  values (new.tenant_id, tg_table_name, new.id, tg_op, auth.uid(), to_jsonb(new));
  return new;
end $$;

create trigger audit_parties   after insert or update on parties        for each row execute function audit_trigger();
create trigger audit_ledger    after insert or update on ledger_entries for each row execute function audit_trigger();
create trigger audit_purchases after insert or update on purchases      for each row execute function audit_trigger();
create trigger audit_collect   after insert or update on collections    for each row execute function audit_trigger();

-- =====================================================================
-- Row level security
-- =====================================================================
alter table tenants        enable row level security;
alter table profiles       enable row level security;
alter table parties        enable row level security;
alter table ledger_entries enable row level security;
alter table purchases      enable row level security;
alter table collections    enable row level security;
alter table audit_log      enable row level security;

create policy tenants_read  on tenants  for select using (id = current_tenant());
create policy profiles_read on profiles for select using (id = auth.uid());

create policy parties_read   on parties for select using (tenant_id = current_tenant());
create policy parties_insert on parties for insert with check (tenant_id = current_tenant());
create policy parties_update on parties for update using (tenant_id = current_tenant())
                                               with check (tenant_id = current_tenant());

create policy ledger_read    on ledger_entries for select using (tenant_id = current_tenant());
create policy purchases_read on purchases      for select using (tenant_id = current_tenant());
create policy collect_read   on collections    for select using (tenant_id = current_tenant());
create policy audit_read     on audit_log      for select using (tenant_id = current_tenant());

-- table privileges: read everywhere, direct writes only on parties
revoke all on tenants, profiles, parties, ledger_entries, purchases, collections, audit_log from anon, authenticated;
grant select on tenants, profiles, ledger_entries, purchases, collections, audit_log to authenticated;
grant select on parties to authenticated;
grant insert (type, name, phone, aliases, notes) on parties to authenticated;
grant update (name, phone, aliases, notes, active) on parties to authenticated;
grant usage, select on sequence audit_log_id_seq to authenticated;

-- =====================================================================
-- RPC functions (the only way to write money data)
-- =====================================================================
create function _tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare t uuid;
begin
  t := current_tenant();
  if t is null then raise exception 'No workspace for this user' using errcode = '42501'; end if;
  return t;
end $$;

create function _check_party(p_party uuid, p_type text, p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_party is null then
    raise exception 'A % is required', p_type;
  end if;
  if not exists (select 1 from parties where id = p_party and tenant_id = p_tenant and type = p_type) then
    raise exception 'Unknown % selected', p_type;
  end if;
end $$;

create function create_workspace(p_name text, p_full_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select tenant_id into t from profiles where id = auth.uid();
  if t is not null then return t; end if;
  insert into tenants (name) values (coalesce(nullif(trim(p_name), ''), 'My business')) returning id into t;
  insert into profiles (id, tenant_id, full_name, role) values (auth.uid(), t, p_full_name, 'owner');
  return t;
end $$;

-- cash in / out that is not a purchase or a collection
create function record_cash_entry(
  p_ref uuid, p_date date, p_kind text, p_amount bigint,
  p_party uuid default null, p_note text default null, p_receipt text default null,
  p_meta jsonb default '{}', p_source text default 'manual',
  p_transcript text default null, p_confidence numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); dir text; new_id uuid;
begin
  if p_ref is not null then
    select id into new_id from ledger_entries where tenant_id = t and client_ref = p_ref;
    if found then return new_id; end if;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;

  case p_kind
    when 'bank_withdrawal','topup','employee_return' then dir := 'in';
    when 'advance','fuel','transport','expense'      then dir := 'out';
    else raise exception 'Kind % is not allowed here', p_kind;
  end case;

  if p_kind in ('advance','employee_return') then
    perform _check_party(p_party, 'employee', t);
  elsif p_party is not null then
    if not exists (select 1 from parties where id = p_party and tenant_id = t) then
      raise exception 'Unknown party selected';
    end if;
  end if;

  insert into ledger_entries (tenant_id, entry_date, kind, direction, amount, party_id, note,
                              receipt_path, meta, source, raw_transcript, ai_confidence, client_ref)
  values (t, coalesce(p_date, current_date), p_kind, dir, p_amount, p_party, p_note,
          p_receipt, coalesce(p_meta,'{}'), p_source, p_transcript, p_confidence, p_ref)
  returning id into new_id;
  return new_id;
end $$;

-- employee spent advance money on something (no cash moves)
create function record_advance_settlement(
  p_ref uuid, p_date date, p_employee uuid, p_amount bigint,
  p_note text default null, p_receipt text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); new_id uuid;
begin
  if p_ref is not null then
    select id into new_id from ledger_entries where tenant_id = t and client_ref = p_ref;
    if found then return new_id; end if;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  perform _check_party(p_employee, 'employee', t);
  insert into ledger_entries (tenant_id, entry_date, kind, direction, affects_cash, amount, party_id,
                              note, receipt_path, client_ref)
  values (t, coalesce(p_date, current_date), 'advance_expense', 'out', false, p_amount, p_employee,
          p_note, p_receipt, p_ref)
  returning id into new_id;
  return new_id;
end $$;

create function record_purchase(
  p_ref uuid, p_date date, p_client uuid, p_vendor text, p_description text,
  p_cost bigint, p_profit bigint, p_note text default null, p_receipt text default null,
  p_source text default 'manual', p_transcript text default null, p_confidence numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); lid uuid; pid uuid;
begin
  if p_ref is not null then
    select id into pid from purchases where tenant_id = t and client_ref = p_ref;
    if found then return pid; end if;
  end if;
  if p_cost is null or p_cost <= 0 then raise exception 'Cost must be greater than zero'; end if;
  if p_profit is null then p_profit := 0; end if;
  if p_cost + p_profit < 0 then raise exception 'Selling price cannot be negative'; end if;
  perform _check_party(p_client, 'client', t);

  insert into ledger_entries (tenant_id, entry_date, kind, direction, amount, party_id, note,
                              receipt_path, source, raw_transcript, ai_confidence, client_ref)
  values (t, coalesce(p_date, current_date), 'purchase', 'out', p_cost, p_client,
          coalesce(nullif(trim(p_description),''), 'Purchase'), p_receipt, p_source, p_transcript, p_confidence, p_ref)
  returning id into lid;

  insert into purchases (tenant_id, client_id, vendor_name, description, cost, profit, purchase_date,
                         ledger_id, receipt_path, note, client_ref)
  values (t, p_client, nullif(trim(p_vendor),''), p_description, p_cost, p_profit,
          coalesce(p_date, current_date), lid, p_receipt, p_note, p_ref)
  returning id into pid;
  return pid;
end $$;

create function record_collection(
  p_ref uuid, p_date date, p_client uuid, p_amount bigint, p_mode text default 'cash',
  p_note text default null, p_source text default 'manual',
  p_transcript text default null, p_confidence numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); lid uuid; cid uuid;
begin
  if p_ref is not null then
    select id into cid from collections where tenant_id = t and client_ref = p_ref;
    if found then return cid; end if;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_mode not in ('cash','transfer','cheque') then raise exception 'Unknown payment mode'; end if;
  perform _check_party(p_client, 'client', t);

  if p_mode = 'cash' then
    insert into ledger_entries (tenant_id, entry_date, kind, direction, amount, party_id, note,
                                source, raw_transcript, ai_confidence, client_ref)
    values (t, coalesce(p_date, current_date), 'collection', 'in', p_amount, p_client, p_note,
            p_source, p_transcript, p_confidence, p_ref)
    returning id into lid;
  end if;

  insert into collections (tenant_id, client_id, amount, mode, collection_date, ledger_id, note, client_ref)
  values (t, p_client, p_amount, p_mode, coalesce(p_date, current_date), lid, p_note, p_ref)
  returning id into cid;
  return cid;
end $$;

-- void a ledger row (and the purchase / collection it belongs to)
create function void_ledger_entry(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); e ledger_entries%rowtype;
begin
  select * into e from ledger_entries where id = p_id and tenant_id = t for update;
  if not found then raise exception 'Entry not found'; end if;
  if e.voided_at is not null then return; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Give a reason for voiding'; end if;

  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_id;
  if e.kind = 'purchase' then
    update purchases set voided_at = now() where ledger_id = p_id and tenant_id = t;
  elsif e.kind = 'collection' then
    update collections set voided_at = now() where ledger_id = p_id and tenant_id = t;
  end if;
end $$;

-- void a collection that has no ledger row (bank transfer / cheque), or any collection
create function void_collection(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := _tenant(); c collections%rowtype;
begin
  select * into c from collections where id = p_id and tenant_id = t for update;
  if not found then raise exception 'Collection not found'; end if;
  if c.voided_at is not null then return; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Give a reason for voiding'; end if;
  if c.ledger_id is not null then
    perform void_ledger_entry(c.ledger_id, p_reason);
  else
    update collections set voided_at = now() where id = p_id;
  end if;
end $$;

-- =====================================================================
-- Read models (security_invoker => RLS of the caller applies)
-- =====================================================================
create view v_client_balances with (security_invoker = true) as
select p.id as party_id, p.tenant_id, p.name, p.phone, p.active,
       coalesce((select sum(sell)   from purchases   x where x.client_id = p.id and x.voided_at is null), 0)::bigint as billed,
       coalesce((select sum(amount) from collections x where x.client_id = p.id and x.voided_at is null), 0)::bigint as collected
from parties p where p.type = 'client';

create view v_employee_balances with (security_invoker = true) as
select p.id as party_id, p.tenant_id, p.name, p.phone, p.active,
  coalesce((select sum(amount) from ledger_entries l where l.party_id = p.id and l.kind = 'advance'         and l.voided_at is null), 0)::bigint as advanced,
  coalesce((select sum(amount) from ledger_entries l where l.party_id = p.id and l.kind = 'employee_return' and l.voided_at is null), 0)::bigint as returned,
  coalesce((select sum(amount) from ledger_entries l where l.party_id = p.id and l.kind = 'advance_expense' and l.voided_at is null), 0)::bigint as spent
from parties p where p.type = 'employee';

create view v_funder_totals with (security_invoker = true) as
select p.id as party_id, p.tenant_id, p.name, p.phone, p.active,
  coalesce((select sum(amount) from ledger_entries l where l.party_id = p.id and l.kind = 'topup' and l.voided_at is null), 0)::bigint as received
from parties p where p.type = 'funder';

-- oldest purchases are treated as paid first (FIFO)
create view v_open_purchases with (security_invoker = true) as
with s as (
  select p.id, p.tenant_id, p.client_id, p.purchase_date, p.description, p.sell,
         sum(p.sell) over (partition by p.client_id order by p.purchase_date, p.created_at, p.id) as cum
  from purchases p where p.voided_at is null
), paid as (
  select client_id, sum(amount) as total from collections where voided_at is null group by client_id
)
select s.id, s.tenant_id, s.client_id, s.purchase_date, s.description, s.sell,
       least(s.sell, greatest(0, s.cum - coalesce(paid.total, 0)))::bigint as outstanding,
       (current_date - s.purchase_date) as age_days
from s left join paid on paid.client_id = s.client_id
where least(s.sell, greatest(0, s.cum - coalesce(paid.total, 0))) > 0;

create view v_client_aging with (security_invoker = true) as
select o.tenant_id, o.client_id, p.name,
  coalesce(sum(o.outstanding) filter (where o.age_days <= 30), 0)::bigint                      as d0_30,
  coalesce(sum(o.outstanding) filter (where o.age_days between 31 and 60), 0)::bigint          as d31_60,
  coalesce(sum(o.outstanding) filter (where o.age_days between 61 and 90), 0)::bigint          as d61_90,
  coalesce(sum(o.outstanding) filter (where o.age_days > 90), 0)::bigint                       as d90_plus,
  sum(o.outstanding)::bigint                                                                   as total
from v_open_purchases o join parties p on p.id = o.client_id
group by o.tenant_id, o.client_id, p.name;

-- dashboard numbers for a date range
create function dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = public as $$
declare t uuid := current_tenant(); r jsonb;
begin
  select jsonb_build_object(
    'cash_in_hand', coalesce((select sum(case direction when 'in' then amount else -amount end)
                              from ledger_entries where tenant_id = t and affects_cash and voided_at is null), 0),
    'receivables',  coalesce((select sum(billed - collected) from v_client_balances where tenant_id = t), 0),
    'with_employees', coalesce((select sum(advanced - returned - spent) from v_employee_balances where tenant_id = t), 0),
    'sales',    coalesce((select sum(sell)   from purchases where tenant_id = t and voided_at is null and purchase_date between p_from and p_to), 0),
    'cost',     coalesce((select sum(cost)   from purchases where tenant_id = t and voided_at is null and purchase_date between p_from and p_to), 0),
    'gross_profit', coalesce((select sum(profit) from purchases where tenant_id = t and voided_at is null and purchase_date between p_from and p_to), 0),
    'fuel',      coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'fuel'      and entry_date between p_from and p_to), 0),
    'transport', coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'transport' and entry_date between p_from and p_to), 0),
    'other_expenses', coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind in ('expense','advance_expense') and entry_date between p_from and p_to), 0),
    'withdrawn', coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'bank_withdrawal' and entry_date between p_from and p_to), 0),
    'topups',    coalesce((select sum(amount) from ledger_entries where tenant_id = t and voided_at is null and kind = 'topup' and entry_date between p_from and p_to), 0),
    'collected', coalesce((select sum(amount) from collections where tenant_id = t and voided_at is null and collection_date between p_from and p_to), 0)
  ) into r;
  return r || jsonb_build_object('net_profit',
      (r->>'gross_profit')::bigint - (r->>'fuel')::bigint - (r->>'transport')::bigint - (r->>'other_expenses')::bigint);
end $$;

-- monthly statement for one client. Shows SELLING prices only (never cost or profit).
create function client_statement(p_client uuid, p_month date) returns jsonb
language plpgsql stable set search_path = public as $$
declare t uuid := current_tenant(); m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
        opening bigint; pur jsonb; col jsonb; ptotal bigint; ctotal bigint; cname text;
begin
  select name into cname from parties where id = p_client and tenant_id = t and type = 'client';
  if cname is null then raise exception 'Client not found'; end if;

  select coalesce((select sum(sell) from purchases where tenant_id = t and client_id = p_client and voided_at is null and purchase_date < m0), 0)
       - coalesce((select sum(amount) from collections where tenant_id = t and client_id = p_client and voided_at is null and collection_date < m0), 0)
    into opening;

  select coalesce(jsonb_agg(jsonb_build_object('date', purchase_date, 'description', description, 'amount', sell) order by purchase_date, created_at), '[]'::jsonb),
         coalesce(sum(sell), 0)
    into pur, ptotal
    from purchases where tenant_id = t and client_id = p_client and voided_at is null and purchase_date >= m0 and purchase_date < m1;

  select coalesce(jsonb_agg(jsonb_build_object('date', collection_date, 'mode', mode, 'amount', amount) order by collection_date, created_at), '[]'::jsonb),
         coalesce(sum(amount), 0)
    into col, ctotal
    from collections where tenant_id = t and client_id = p_client and voided_at is null and collection_date >= m0 and collection_date < m1;

  return jsonb_build_object('client', cname, 'month', m0, 'opening', opening,
           'purchases', pur, 'purchases_total', ptotal,
           'collections', col, 'collections_total', ctotal,
           'closing', opening + ptotal - ctotal);
end $$;

-- function privileges
revoke execute on all functions in schema public from public, anon;
grant execute on function create_workspace(text, text),
                          record_cash_entry(uuid, date, text, bigint, uuid, text, text, jsonb, text, text, numeric),
                          record_advance_settlement(uuid, date, uuid, bigint, text, text),
                          record_purchase(uuid, date, uuid, text, text, bigint, bigint, text, text, text, text, numeric),
                          record_collection(uuid, date, uuid, bigint, text, text, text, text, numeric),
                          void_ledger_entry(uuid, text), void_collection(uuid, text),
                          dashboard_summary(date, date), client_statement(uuid, date),
                          current_tenant()
  to authenticated;
grant select on v_client_balances, v_employee_balances, v_funder_totals, v_open_purchases, v_client_aging to authenticated;
