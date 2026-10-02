-- Smoke test for the money logic. Run after the migration. Fails loudly (raise exception) on any mismatch.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','a@test'), ('22222222-2222-2222-2222-222222222222','b@test')
on conflict do nothing;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_workspace('Tester Trading', 'Tester');

insert into parties (type, name) values ('client','Al-Rajhi Office'),('client','Delta Co'),('employee','Ahmed'),('funder','CEO Khalid'),('vendor','Jarir');

do $$
declare rajhi uuid; delta uuid; ahmed uuid; ceo uuid; d jsonb; n int; s jsonb; bal record;
begin
  select id into rajhi from parties where name='Al-Rajhi Office';
  select id into delta from parties where name='Delta Co';
  select id into ahmed from parties where name='Ahmed';
  select id into ceo   from parties where name='CEO Khalid';

  -- cash in: bank withdrawal 10,000 SAR + CEO top-up 2,000 SAR
  perform record_cash_entry(gen_random_uuid(), current_date, 'bank_withdrawal', 1000000);
  perform record_cash_entry(gen_random_uuid(), current_date, 'topup', 200000, ceo);

  -- purchases: cost 4,500 profit 500 for Rajhi (sell 5,000) ; cost 1,000 profit 100 for Delta
  perform record_purchase(gen_random_uuid(), current_date - 70, rajhi, 'Jarir', '2 desktops', 450000, 50000);
  perform record_purchase(gen_random_uuid(), current_date - 5,  rajhi, 'Jarir', 'Monitor',     100000, 10000);
  perform record_purchase(gen_random_uuid(), current_date - 3,  delta, null,    'Cabling',     100000, 10000);

  -- advance 500 to Ahmed, he returns 100 and spent 300 on a task
  perform record_cash_entry(gen_random_uuid(), current_date, 'advance', 50000, ahmed);
  perform record_cash_entry(gen_random_uuid(), current_date, 'employee_return', 10000, ahmed);
  perform record_advance_settlement(gen_random_uuid(), current_date, ahmed, 30000, 'Taxi + delivery');

  -- fuel 80, transport 40
  perform record_cash_entry(gen_random_uuid(), current_date, 'fuel', 8000);
  perform record_cash_entry(gen_random_uuid(), current_date, 'transport', 4000);

  -- Rajhi pays 3,000 cash, then 500 by bank transfer (no cash effect)
  perform record_collection(gen_random_uuid(), current_date, rajhi, 300000, 'cash');
  perform record_collection(gen_random_uuid(), current_date, rajhi, 50000, 'transfer');

  d := dashboard_summary(date_trunc('month', current_date)::date - 100, current_date);
  raise notice 'dashboard: %', d;

  -- cash: 10000+2000-4500-1000-1000-500+100-80-40+3000 = 7,980 SAR (advance_expense and bank transfer do not touch cash)
  assert (d->>'cash_in_hand')::bigint = 798000, 'cash_in_hand wrong: ' || (d->>'cash_in_hand');
  -- receivables: billed 5000+1100+1100 = 7200 ; collected 3500  => 3700
  assert (d->>'receivables')::bigint = 370000, 'receivables wrong';
  -- employee holding: 500 - 100 - 300 = 100
  assert (d->>'with_employees')::bigint = 10000, 'with_employees wrong';
  -- profit: 500+100+100 = 700 ; expenses: fuel 80 + transport 40 + advance_expense 300 = 420 ; net 280
  assert (d->>'gross_profit')::bigint = 70000, 'gross_profit wrong';
  assert (d->>'net_profit')::bigint = 28000, 'net_profit wrong: ' || (d->>'net_profit');

  -- FIFO aging: Rajhi billed 5000 (70d) + 1100 (5d); paid 3500 => 70d purchase has 1500 left, 5d purchase 1100 left
  select * into bal from v_client_aging where client_id = rajhi;
  assert bal.d61_90 = 150000 and bal.d0_30 = 110000 and bal.total = 260000, 'aging wrong: ' || bal::text;

  -- idempotency: same ref twice creates one row
  perform record_cash_entry('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'expense', 1000);
  perform record_cash_entry('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'expense', 1000);
  select count(*) into n from ledger_entries where client_ref = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 1, 'idempotency broken';

  -- voiding the purchase removes it from cash, receivables and profit
  perform void_ledger_entry((select ledger_id from purchases where description='Monitor'), 'entered twice');
  d := dashboard_summary(current_date - 100, current_date);
  assert (d->>'receivables')::bigint = 370000 - 110000, 'void did not reduce receivables';

  -- statement never exposes cost/profit
  s := client_statement(rajhi, date_trunc('month', current_date - 70)::date);
  assert s::text not like '%cost%' and s::text not like '%profit%', 'statement leaks cost/profit';
  raise notice 'statement: %', s;

  -- validation
  begin perform record_cash_entry(gen_random_uuid(), current_date, 'advance', 100, null); assert false, 'advance without employee accepted';
  exception when others then if sqlerrm like 'advance without%' then raise; end if; end;
  begin perform record_cash_entry(gen_random_uuid(), current_date, 'fuel', 0); assert false, 'zero amount accepted';
  exception when others then if sqlerrm like 'zero amount%' then raise; end if; end;
end $$;

-- direct writes to money tables must be impossible from the client
do $$ begin
  begin insert into ledger_entries (tenant_id, kind, direction, amount) values (current_tenant(),'expense','out',1); raise exception 'direct insert allowed!';
  exception when insufficient_privilege then null; end;
  begin delete from ledger_entries; raise exception 'direct delete allowed!';
  exception when insufficient_privilege then null; end;
end $$;

-- tenant isolation: user B sees nothing of A
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_workspace('Other Co');
do $$ declare n int; begin
  select count(*) into n from ledger_entries; assert n = 0, 'tenant leak: ledger';
  select count(*) into n from parties;        assert n = 0, 'tenant leak: parties';
  select count(*) into n from v_client_balances; assert n = 0, 'tenant leak: view';
  begin perform record_purchase(gen_random_uuid(), current_date, (select id from parties limit 1), null, 'x', 100, 0);
  exception when others then null; end;
end $$;
\echo ALL SMOKE TESTS PASSED
