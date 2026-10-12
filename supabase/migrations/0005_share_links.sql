-- =====================================================================
-- Read-only share link
-- The owner creates one secret link per workspace and sends it (WhatsApp, SMS, email).
-- Anyone opening it can READ the workspace without an account; nothing can be written.
-- The link never expires. Resetting it replaces the token, so the old link stops working at once.
--
-- Safety: this migration only ADDS a table and functions. dashboard_summary and
-- client_statement keep their exact signatures and results; their bodies move into
-- tenant-parameterised internals so the owner and the shared view share one calculation.
-- =====================================================================

create schema if not exists extensions;   -- already present on Supabase
create extension if not exists pgcrypto with schema extensions;

create table share_links (
  tenant_id      uuid primary key references tenants(id) on delete cascade,  -- one link per workspace
  token          text not null unique check (length(token) >= 32),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  last_viewed_at timestamptz
);
-- No policies and no grants: only the security definer functions below can touch it.
alter table share_links enable row level security;
revoke all on share_links from public, anon, authenticated;

-- ---------- internals (never callable by clients: they take any tenant id) ----------

create function _owner_tenant() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare t uuid := _tenant();
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Only the workspace owner can manage the share link' using errcode = '42501';
  end if;
  return t;
end $$;

-- Resolve a share token to its workspace. The same error for "malformed" and "unknown",
-- so a caller learns nothing beyond "this link does not work".
create function _share_tenant(p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare t uuid;
begin
  if p_token is not null and length(p_token) between 32 and 128 then
    select tenant_id into t from share_links where token = p_token;
  end if;
  if t is null then raise exception 'share_link_invalid' using errcode = '42501'; end if;
  return t;
end $$;

create function _dashboard_summary(t uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
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

create function _client_statement(t uuid, p_client uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
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

-- The signed-in versions now delegate to the shared internals (same signature, same output).
-- security definer so they may call the internals; the tenant still comes from the caller's login.
create or replace function dashboard_summary(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select _dashboard_summary(current_tenant(), p_from, p_to)
$$;

create or replace function client_statement(p_client uuid, p_month date) returns jsonb
language sql stable security definer set search_path = public as $$
  select _client_statement(current_tenant(), p_client, p_month)
$$;

-- ---------- owner: manage the link ----------

create function share_link_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := _owner_tenant(); s share_links%rowtype;
begin
  select * into s from share_links where tenant_id = t;
  if not found then return null; end if;
  return jsonb_build_object('token', s.token, 'created_at', s.created_at, 'last_viewed_at', s.last_viewed_at);
end $$;

-- Creates the link, or replaces it (reset): the previous token stops working immediately.
create function share_link_reset() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t uuid := _owner_tenant(); had boolean; s share_links%rowtype;
begin
  had := exists (select 1 from share_links where tenant_id = t);
  -- 24 random bytes -> 32 URL-safe characters (192 bits: not guessable)
  insert into share_links (tenant_id, token, created_by)
  values (t, translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), auth.uid())
  on conflict (tenant_id) do update
    set token = excluded.token, created_by = excluded.created_by, created_at = now(), last_viewed_at = null
  returning * into s;
  insert into audit_log (tenant_id, table_name, row_id, action, actor, data)
  values (t, 'share_links', t, case when had then 'RESET' else 'CREATE' end, auth.uid(), '{}'::jsonb);
  return jsonb_build_object('token', s.token, 'created_at', s.created_at, 'last_viewed_at', s.last_viewed_at);
end $$;

create function share_link_disable() returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := _owner_tenant();
begin
  delete from share_links where tenant_id = t;
  if found then
    insert into audit_log (tenant_id, table_name, row_id, action, actor, data)
    values (t, 'share_links', t, 'DELETE', auth.uid(), '{}'::jsonb);
  end if;
end $$;

-- ---------- viewer: read-only, by token, no account needed ----------
-- Every function here only SELECTs. There is no write path that accepts a token.

create function share_workspace(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t uuid := _share_tenant(p_token); r jsonb;
begin
  -- remember when the link was last used (at most every 10 minutes, to keep writes rare)
  update share_links set last_viewed_at = now()
   where tenant_id = t and (last_viewed_at is null or last_viewed_at < now() - interval '10 minutes');
  select jsonb_build_object('name', name, 'currency', currency) into r from tenants where id = t;
  return r;
end $$;

create function share_dashboard(p_token text, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select _dashboard_summary(_share_tenant(p_token), p_from, p_to)
$$;

create function share_statement(p_token text, p_client uuid, p_month date) returns jsonb
language sql stable security definer set search_path = public as $$
  select _client_statement(_share_tenant(p_token), p_client, p_month)
$$;

-- Ledger rows without internal fields (voice transcripts, device refs, receipt paths, user ids).
create function share_ledger(p_token text, p_from date default null, p_to date default null,
                             p_party uuid default null, p_limit int default 300) returns jsonb
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
           order by l.entry_date desc, l.created_at desc)
    from (select * from ledger_entries
           where tenant_id = t
             and (p_from is null or entry_date >= p_from)
             and (p_to is null or entry_date <= p_to)
             and (p_party is null or party_id = p_party)
           order by entry_date desc, created_at desc
           limit greatest(1, least(coalesce(p_limit, 300), 1000))) l
    left join parties p on p.id = l.party_id), '[]'::jsonb);
end $$;

create function share_parties(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'name', name, 'phone', phone,
                                               'aliases', '[]'::jsonb, 'notes', null, 'active', active) order by name), '[]'::jsonb)
  from parties where tenant_id = _share_tenant(p_token)
$$;

create function share_client_balances(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(v) order by v.name), '[]'::jsonb)
  from v_client_balances v where v.tenant_id = _share_tenant(p_token)
$$;

create function share_employee_balances(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(v) order by v.name), '[]'::jsonb)
  from v_employee_balances v where v.tenant_id = _share_tenant(p_token)
$$;

create function share_aging(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(v) order by v.total desc), '[]'::jsonb)
  from v_client_aging v where v.tenant_id = _share_tenant(p_token)
$$;

create function share_open_purchases(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(v) order by v.purchase_date), '[]'::jsonb)
  from v_open_purchases v where v.tenant_id = _share_tenant(p_token)
$$;

-- ---------- privileges ----------
-- Supabase grants EXECUTE on new functions to anon/authenticated by default, so revoke first.
revoke execute on function _owner_tenant(), _share_tenant(text),
                           _dashboard_summary(uuid, date, date), _client_statement(uuid, uuid, date),
                           share_link_get(), share_link_reset(), share_link_disable(),
                           share_workspace(text), share_dashboard(text, date, date), share_statement(text, uuid, date),
                           share_ledger(text, date, date, uuid, int), share_parties(text),
                           share_client_balances(text), share_employee_balances(text),
                           share_aging(text), share_open_purchases(text)
  from public, anon, authenticated;

grant execute on function share_link_get(), share_link_reset(), share_link_disable() to authenticated;

grant execute on function share_workspace(text), share_dashboard(text, date, date), share_statement(text, uuid, date),
                          share_ledger(text, date, date, uuid, int), share_parties(text),
                          share_client_balances(text), share_employee_balances(text),
                          share_aging(text), share_open_purchases(text)
  to anon, authenticated;
