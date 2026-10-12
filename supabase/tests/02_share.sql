-- Share-link tests. Run after 01_smoke.sql (reuses its workspaces). Fails loudly on any mismatch.
\set ON_ERROR_STOP on
reset role;
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','c@test') on conflict do nothing;
insert into profiles (id, tenant_id, role)
  select '33333333-3333-3333-3333-333333333333', tenant_id, 'accountant' from profiles
   where id = '11111111-1111-1111-1111-111111111111'
on conflict do nothing;

-- ---------- owner creates a link; remember what the owner sees ----------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare s jsonb; rajhi uuid;
begin
  assert share_link_get() is null, 'link exists before creation';
  s := share_link_reset();
  assert length(s->>'token') = 32, 'token length: ' || (s->>'token');
  assert (s->>'token') ~ '^[A-Za-z0-9_-]+$', 'token not URL-safe';
  assert share_link_get()->>'token' = s->>'token', 'share_link_get mismatch';
  select id into rajhi from parties where name = 'Al-Rajhi Office';
  perform set_config('naqd.tok',   s->>'token', false);
  perform set_config('naqd.rajhi', rajhi::text, false);
  perform set_config('naqd.dash',  dashboard_summary(current_date - 100, current_date)::text, false);
  perform set_config('naqd.stmt',  client_statement(rajhi, date_trunc('month', current_date)::date)::text, false);
  perform set_config('naqd.nled',  (select count(*) from ledger_entries)::text, false);
end $$;

-- ---------- anonymous viewer with the token: same numbers, read-only ----------
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
declare tok text := current_setting('naqd.tok'); led jsonb;
begin
  assert share_workspace(tok)->>'name' = 'Tester Trading', 'workspace name';
  assert share_dashboard(tok, current_date - 100, current_date) = current_setting('naqd.dash')::jsonb, 'dashboard differs from owner view';
  assert share_statement(tok, current_setting('naqd.rajhi')::uuid, date_trunc('month', current_date)::date) = current_setting('naqd.stmt')::jsonb, 'statement differs';
  assert share_statement(tok, current_setting('naqd.rajhi')::uuid, date_trunc('month', current_date)::date)::text not like '%cost%', 'statement leaks cost';

  led := share_ledger(tok, null, null, null, 1000);
  assert jsonb_array_length(led) = current_setting('naqd.nled')::int, 'ledger row count differs';
  assert not (led->0 ? 'raw_transcript') and not (led->0 ? 'client_ref') and not (led->0 ? 'created_by'), 'ledger leaks internal fields';
  assert jsonb_array_length(share_ledger(tok, null, null, null, 2)) = 2, 'limit ignored';
  assert jsonb_array_length(share_parties(tok)) > 0, 'parties empty';
  assert jsonb_array_length(share_client_balances(tok)) > 0, 'client balances empty';
  assert jsonb_array_length(share_employee_balances(tok)) > 0, 'employee balances empty';
  assert jsonb_array_length(share_aging(tok)) > 0, 'aging empty';
  assert jsonb_array_length(share_open_purchases(tok)) > 0, 'open purchases empty';

  -- wrong / malformed tokens all fail the same way
  begin perform share_dashboard('x', current_date, current_date); raise exception 'short token accepted';
  exception when insufficient_privilege then null; end;
  begin perform share_ledger(repeat('A', 32)); raise exception 'unknown token accepted';
  exception when insufficient_privilege then null; end;
  begin perform share_workspace(null); raise exception 'null token accepted';
  exception when insufficient_privilege then null; end;

  -- nothing else is reachable without a login
  begin perform _dashboard_summary(gen_random_uuid(), current_date, current_date); raise exception 'anon ran an internal function';
  exception when insufficient_privilege then null; end;
  begin perform share_link_get(); raise exception 'anon read the link';
  exception when insufficient_privilege then null; end;
  begin perform share_link_reset(); raise exception 'anon reset the link';
  exception when insufficient_privilege then null; end;
  begin perform record_cash_entry(gen_random_uuid(), current_date, 'expense', 100); raise exception 'anon wrote an entry';
  exception when insufficient_privilege then null; end;
  begin perform void_ledger_entry(gen_random_uuid(), 'x'); raise exception 'anon voided an entry';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from share_links; raise exception 'anon read share_links';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from ledger_entries; raise exception 'anon read ledger_entries';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- another workspace's owner cannot see or change A's link ----------
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert share_link_get() is null, 'B sees a link it never made';
  perform share_link_disable();   -- only affects B's own workspace
  assert share_workspace(current_setting('naqd.tok'))->>'name' = 'Tester Trading', 'B disabled A''s link';
  begin perform _client_statement(gen_random_uuid(), gen_random_uuid(), current_date); raise exception 'user ran an internal function';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- a non-owner member of A cannot manage the link ----------
reset role;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  begin perform share_link_reset(); raise exception 'accountant reset the link';
  exception when insufficient_privilege then null; end;
  begin perform share_link_get(); raise exception 'accountant read the link';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- reset kills the old link; disable kills everything ----------
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare old text := current_setting('naqd.tok'); fresh text; n int;
begin
  fresh := share_link_reset()->>'token';
  assert fresh <> old, 'reset kept the same token';
  begin perform share_workspace(old); raise exception 'old link still works after reset';
  exception when insufficient_privilege then null; end;
  assert share_workspace(fresh)->>'name' = 'Tester Trading', 'new link does not work';

  perform share_link_disable();
  assert share_link_get() is null, 'link still exists after disable';
  begin perform share_workspace(fresh); raise exception 'link still works after disable';
  exception when insufficient_privilege then null; end;

  select count(*) into n from audit_log where table_name = 'share_links';
  assert n = 3, 'expected CREATE, RESET, DELETE in audit log, got ' || n;
end $$;
\echo ALL SHARE TESTS PASSED
