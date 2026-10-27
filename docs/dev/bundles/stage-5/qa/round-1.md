# QA round 1 (orchestrator, 2026-10-27): the fixture tree

Kept fixture tree from `KEEP=1 bash scripts/ci/fixture.sh` at fix:whole's HEAD (c09a0656): `fixture: PASS, every step as expected`; readouts 31 checks 30 PASS 1 WARN (init, doctor), 27 PASS 4 WARN (the secrets step). The fixture itself asserts the banner, the injected length, the redacted echo, binary output byte-identical, the stale export dropped, the loopback URL accepted, the value on the argv refused, the proof mismatch refused at exit 125 with nothing started, the three doctor rows and the planted rc line.

Beyond the fixture, run by hand in that tree (scratch HOME, the declared and ambient names unset, the fixture's identity), every step as expected:

1. An inherited tunnel-shaped URL (`postgres.<ref>:<pw>@localhost:5433`) exported under `DB_URL` and typed on the argv: refused, exit 125, `argument 2 holds the value of DB_URL`. The same URL typed without the export: passes the shape check (a loopback host, amendment 43). The local stack's `postgres:postgres@127.0.0.1:54322` inherited and typed: passes (the public default). `postgresql://u:pw@[::1].evil.example/db` on the argv: refused, exit 125 (fix:whole finding 1).
2. `secrets set dev NOT_DECLARED --stdin`: refused, exit 125, `is not one of dev's names`.
3. `SERVICE_ROLE_KEY` removed from `dev`'s names in the config: `run dev -- true` refused, exit 125, naming `secrets set dev SUPABASE_URL`; `secrets set dev SUPABASE_URL --stdin` printed `removed SERVICE_ROLE_KEY from dev's values, no longer declared`; `run dev -- true` then exit 0 injecting two names; the config and ciphertext restored, `run` back to three names (fix:whole finding 5).
4. An `.envrc` at the root: `WARN secrets.carriers .envrc at the root …`; removed: PASS.
5. A second repo (`app2`, the same tarball, `init`, a `host` proof on `api.example.com`): `secrets init --yes` read the existing identity's public key (`read the public key of …; the identity is unchanged`), wrote no identity, its `recipients.txt` equal to the first repo's; committed through the hooks; `secrets set dev API_URL --stdin`; `run dev -- true` exit 0, `proved API_URL against api.example.com (host)`; a second `secrets init --yes`: `already holds this identity's public key; nothing written`, exit 0 (fix:engine finding 4).

## Findings

- P3, wording: on a second `secrets init` in a repo whose recipients file already holds this very identity's key, the `held` line (`secrets/recipients.txt already holds 1 recipient(s) (…): one identity per developer, so on a second machine copy your identity there rather than make a new one; a new recipient cannot read what is already encrypted until each value is set again`) prints before the check that the held key is this identity's, so the developer is told to copy their identity to a second machine while running on the machine that has it; the next line (`already holds this identity's public key; nothing written`) is the right one. Suggested: skip the `held` warning when the held key is this identity's, or print it only when a new key would be appended.

## The developer's hands (plan §8), not run here

The 1Password run, the keychain `secrets set` with a real-length value, the locked-keychain attribute lookup, `ps eww` on another same-user process, the guide's psql wrapper under `run dev`, and a fresh Expo app from the published path once 0.3.0 exists. The kept tree is at the fixture's working directory named in the run's first line, under the system temp folder.
