# Data model

This doc is the contract for the database: every migration in `supabase/migrations/` has one row in the first table, keyed by its file name, and the tables and RPCs the migrations create are described below it. The supabase pack reads it two ways. At commit, the doc-sync rule `supabase:data-doc` refuses a change to a migration that does not stage this file. In doctor, the row `pack.supabase.docs` counts the migrations with no row here and names the first ones. Keep the first column exactly the migration's file name.

## Migrations

| Migration | Tables and RPCs touched | Summary |
| --- | --- | --- |

## Tables

| Table | Purpose | RLS |
| --- | --- | --- |

## RPCs

| RPC | Signature | Purpose |
| --- | --- | --- |
