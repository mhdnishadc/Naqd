# Naqd (نقد)

Cash, purchases and collections tracker for a trader who buys goods and services with his own cash
for client companies, bills them monthly with profit, and collects later.

**Phase 1 + 2 are implemented:** clients / employees / funders / vendors, cash ledger, purchases with
profit, collections (cash / transfer / cheque), fuel & transport, employee advances and settlement,
dashboard, FIFO aging (0–30 / 31–60 / 61–90 / 90+), monthly client statements (print/PDF, WhatsApp text,
CSV), receipt photos, offline entry with auto-sync, English + Arabic (RTL), void-with-audit-trail.

Stack: React + Vite PWA · Supabase (Auth, Postgres + RLS, Storage) · Cloudflare Pages. No separate backend yet.

## 1. Run locally

```bash
npm install
cp .env.example .env.local      # fill in your Supabase URL + anon key
npm run dev                     # http://localhost:5173
```

## 2. Set up Supabase (free)

1. Create a project at supabase.com.
2. SQL Editor → run `supabase/migrations/0001_schema.sql`, then `0002_receipts_storage.sql`.
   (Or with the CLI: `supabase link && supabase db push`.)
3. Authentication → Providers → Email. For a single-user tool you can switch off "Confirm email";
   otherwise the first sign-up needs the confirmation link.
4. Project Settings → API → copy the **URL** and **anon public key** into `.env.local`.
   Never put the `service_role` key in the frontend.
5. Open the app, create an account, then create your workspace (business name).

## 3. Deploy on Cloudflare Workers

- Connect the GitHub repo → build `npm run build` → deploy `npx wrangler deploy`.
- `wrangler.jsonc` serves `dist/` as static assets with SPA routing (`not_found_handling`).
- **Build** variables (Settings → Build → Variables and secrets, not runtime variables):
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. They are baked in at build time.
- In Supabase → Authentication → URL Configuration, add your `workers.dev` (or custom) URL as Site URL.

## 4. Protect the free tier

`.github/workflows/supabase-keepalive-backup.yml` pings the project daily (prevents auto-pause) and
takes a weekly `pg_dump`. Add the three repo secrets listed at the top of that file.
Also use **Settings → Download full backup** in the app now and then.

## 5. Test the money logic

```bash
npm run test:db     # needs local Postgres; creates a throwaway DB and runs supabase/tests/01_smoke.sql
```
It checks cash balance, receivables, FIFO aging, employee advances, voiding, idempotent retries,
tenant isolation, that direct table writes are blocked, and that statements never expose cost or profit.

## How the money works

- Amounts are integer halalas (1 SAR = 100). No floats stored.
- `ledger_entries` = every movement of cash. **Cash in hand** = cash-in − cash-out.
  Bank transfers/cheques from clients and employee-spent advances do not touch cash.
- Receivables = billed (cost + profit) − collected. Oldest purchases are treated as paid first.
- Employee holding = advanced − returned − spent.
- Nothing is deleted. Mistakes are **voided** with a reason; the audit log keeps every change.
- All writes go through RPC functions (`record_purchase`, `record_collection`, `record_cash_entry`,
  `record_advance_settlement`, `void_*`). The browser cannot insert into money tables directly.
- Every entry carries a device-generated id, so an offline retry can never double-book.

## Project layout

```
supabase/migrations/   schema, RLS, RPC functions, views, receipt bucket
supabase/tests/        Postgres smoke tests
src/lib/               supabase client, money helpers, offline outbox, api, i18n, auth
src/pages/             Dashboard, NewEntry, Ledger, Parties, Receivables, Advances, Statements, Settings
```

## Not yet (later phases)

Voice entry (the schema already has `source`, `raw_transcript`, `ai_confidence` and party `aliases`),
WhatsApp reminders, ZATCA e-invoicing, staff roles beyond the owner, multi-user invites.
Note: every user in a workspace currently has full access; the `role` column is ready for Phase 3.
