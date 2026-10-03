#!/usr/bin/env bash
# Usage: ./supabase/tests/run.sh   (needs local Postgres; run as a user that can create databases)
set -e
DB=naqd_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -d $DB -f supabase/tests/00_stub_auth.sql -f supabase/migrations/0001_schema.sql -f supabase/migrations/0003_delete_party.sql
psql -q -d $DB -f supabase/tests/01_smoke.sql
