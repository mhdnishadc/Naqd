-- Vendor refund (purchase return) tests. Run after 01_smoke.sql. Fails loudly on any mismatch.
\set ON_ERROR_STOP on
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare cabling uuid; cabling_ledger uuid; delta uuid; before jsonb; after jsonb; r1 uuid; r2 uuid; n int;
        bal record; s jsonb; m date := date_trunc('month', current_date)::date;
begin
  -- 'Cabling' for Delta: cost 1,000, profit 100, sell 1,100, bought 3 days ago
  select id, ledger_id, client_id into cabling, cabling_ledger, delta from purchases where description = 'Cabling';
  before := dashboard_summary(current_date - 100, current_date);

  -- partial return: vendor refunds 500 cash; client credit defaults to the same share of the bill (550)
  r1 := record_purchase_return('bbbbbbbb-0000-0000-0000-000000000001', current_date, cabling, 50000);
  assert (select credit from purchase_returns where id = r1) = 55000, 'default credit should be proportional';
  -- same ref again: no second return
  perform record_purchase_return('bbbbbbbb-0000-0000-0000-000000000001', current_date, cabling, 50000);
  select count(*) into n from purchase_returns where purchase_id = cabling;
  assert n = 1, 'idempotency broken for returns';

  after := dashboard_summary(current_date - 100, current_date);
  assert (after->>'cash_in_hand')::bigint = (before->>'cash_in_hand')::bigint + 50000, 'cash did not go up by the refund';
  assert (after->>'receivables')::bigint  = (before->>'receivables')::bigint - 55000, 'receivables did not drop by the credit';
  assert (after->>'sales')::bigint        = (before->>'sales')::bigint - 55000, 'sales not reduced';
  assert (after->>'cost')::bigint         = (before->>'cost')::bigint - 50000, 'cost not reduced';
  assert (after->>'gross_profit')::bigint = (before->>'gross_profit')::bigint - 5000, 'profit not reduced by the returned margin';
  assert (after->>'vendor_refunds')::bigint = 50000, 'vendor_refunds total wrong';

  -- the ledger shows it as cash in
  assert exists (select 1 from ledger_entries where kind = 'vendor_refund' and direction = 'in' and amount = 50000
                   and party_id = delta and voided_at is null), 'ledger row missing';

  -- aging: Delta's open amount is the purchase net of the credit
  select * into bal from v_client_aging where client_id = delta;
  assert bal.total = 110000 - 55000, 'aging not net of return: ' || bal::text;

  -- statement: return line as a credit, closing balance reduced, no cost or refund figure leaked
  s := client_statement(delta, m);
  assert (s->>'returns_total')::bigint = 55000, 'statement returns_total wrong';
  assert (s->>'closing')::bigint = (s->>'opening')::bigint + (s->>'purchases_total')::bigint - 55000 - (s->>'collections_total')::bigint, 'closing wrong';
  assert s::text not like '%refund%' and s::text not like '%cost%', 'statement leaks vendor refund / cost';

  -- limits: only 500 cost left to refund
  begin perform record_purchase_return(gen_random_uuid(), current_date, cabling, 50001); raise exception 'over-refund accepted';
  exception when others then if sqlerrm like 'over-refund%' then raise; end if; end;
  begin perform record_purchase_return(gen_random_uuid(), current_date, cabling, 100, 60000); raise exception 'over-credit accepted';
  exception when others then if sqlerrm like 'over-credit%' then raise; end if; end;
  begin perform record_purchase_return(gen_random_uuid(), current_date - 10, cabling, 100); raise exception 'return before purchase accepted';
  exception when others then if sqlerrm like 'return before%' then raise; end if; end;
  begin perform record_purchase_return(gen_random_uuid(), current_date, cabling, 0); raise exception 'zero refund accepted';
  exception when others then if sqlerrm like 'zero refund%' then raise; end if; end;

  -- the purchase cannot be voided while it has a live refund
  begin perform void_ledger_entry(cabling_ledger, 'test'); raise exception 'voided a purchase with refunds';
  exception when others then if sqlerrm like 'voided a purchase%' then raise; end if; end;

  -- returning the rest: the full remainder of the bill is credited automatically
  r2 := record_purchase_return(gen_random_uuid(), current_date, cabling, 50000);
  assert (select credit from purchase_returns where id = r2) = 55000, 'full return should credit the rest of the bill';
  assert not exists (select 1 from v_open_purchases where id = cabling), 'fully returned purchase still open';
  begin perform record_purchase_return(gen_random_uuid(), current_date, cabling, 1); raise exception 'refund after full return accepted';
  exception when others then if sqlerrm like 'refund after%' then raise; end if; end;

  -- voiding both refunds puts every number back
  perform void_ledger_entry((select ledger_id from purchase_returns where id = r1), 'test');
  perform void_ledger_entry((select ledger_id from purchase_returns where id = r2), 'test');
  assert (select count(*) from purchase_returns where purchase_id = cabling and voided_at is null) = 0, 'returns not voided';
  after := dashboard_summary(current_date - 100, current_date);
  assert after - 'vendor_refunds' = before - 'vendor_refunds', 'voiding refunds did not restore the dashboard';
  -- and now the purchase itself may be voided again
  perform void_ledger_entry(cabling_ledger, 'test');
end $$;

-- the money tables stay closed to direct writes
do $$ begin
  begin insert into purchase_returns (tenant_id, purchase_id, client_id, refund, credit)
        select tenant_id, id, client_id, 1, 1 from purchases limit 1;
        raise exception 'direct insert into purchase_returns allowed!';
  exception when insufficient_privilege then null; end;
  begin perform record_cash_entry(gen_random_uuid(), current_date, 'vendor_refund', 100); raise exception 'vendor_refund via record_cash_entry';
  exception when others then if sqlerrm like 'vendor_refund via%' then raise; end if; end;
end $$;

-- other workspaces see nothing
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ declare n int; begin
  select count(*) into n from purchase_returns; assert n = 0, 'tenant leak: purchase_returns';
  begin perform record_purchase_return(gen_random_uuid(), current_date, (select id from purchases limit 1), 100);
        raise exception 'returned another workspace''s purchase';
  exception when others then if sqlerrm like 'returned another%' then raise; end if; end;
end $$;
\echo ALL RETURN TESTS PASSED
