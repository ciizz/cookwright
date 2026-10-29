# QA round 3 (the developer, 2026-10-29): the 1Password retest

The fixed package (qa run 2, c565889, gate #11 green) packed and installed into the same kept fixture tree; the config back on the `1password` backend; a throwaway vault and item recreated, each with a space in its name (`op` 2.39.0, the 1Password app unlocked, CLI integration on).

- `run dev -- true`: exit 0, banner `run: dev · injected SUPABASE_URL, DB_URL, SERVICE_ROLE_KEY · proved SUPABASE_URL, DB_URL against fixturefixturefixtur (supabase) · unproved SERVICE_ROLE_KEY · dropped from the environment: OP_SESSION_<account>, SUPABASE_DB_URL · child output piped through the redactor (no terminal on stdout/stderr)`. The `{{ }}` form read the spaced vault and item names whole; the 1Password session variable was dropped from the child (disposition 50).
- `run dev -- sh -c 'echo "$DB_URL"'`: exit 0, printed exactly `<DB_URL>`.
- No `cookwright-op-*` directory left under the system temp folder (`0`).
- The throwaway vault deleted.

Round 2's P1 is closed by measurement. No new finding. The QA phase can close: the fixture tree (round 1), the developer's 1Password, keychain and `ps eww` runs (rounds 2 and 3). Not measured: the guide's psql wrapper against a real database; a fresh Expo app from the published package (after the release).
