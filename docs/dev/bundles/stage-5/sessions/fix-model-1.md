# fix:model — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `46ed5e0 fix: a postgres URL listing more than one host is refused by both proof kinds`
- `152f7c2 fix: the host proof keeps a value's port as its own scheme reads it`
- `11b6394 fix: the recipients file must stay tracked and its index equal HEAD`
- `e7fc004 fix: libpq's routing names join the names a postgres URL's child never inherits`
- `b7ed0ab fix: prove covers a proof's default names from the target, not from the values`
- `6408cd9 docs: the updating guide reads version 4 and points at the secrets step`

## Files
- `packages/cookwright/src/lib/secret/proofs.mjs`
- `packages/cookwright/src/lib/secret/proofs.test.mjs`
- `packages/cookwright/packs/supabase/pack.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/secret/recipients.mjs`
- `packages/cookwright/src/lib/secret/recipients.test.mjs`
- `packages/cookwright/src/lib/secret/config.mjs`
- `packages/cookwright/src/lib/secret/config.test.mjs`
- `packages/cookwright/src/lib/packs/registry.test.mjs`
- `docs/guides/secrets.md`
- `docs/guides/updating.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.secrets.proof (proofAnchors.hostList)` | it lists more than one host (a comma, or %2C, in its host part), and libpq connects to the first that answers | The anchor text in the proof refusal line when a postgres URL's host part lists several hosts (finding 4). |
| `messages.secrets.recipients (recipientsWhy.removed)` | ${rel} is staged for deletion (git restore --staged -- ${rel} undoes it): keep it tracked, so a recipient is reviewed before anything is encrypted to it | Shown when the recipients file is in HEAD but no longer in the index (finding 1). |
| `messages.secrets.recipients (recipientsWhy.staged)` | ${rel} has a staged change (git diff --cached -- ${rel}): commit it first, so a recipient is reviewed before anything is encrypted to it | Shown when the index version of the recipients file differs from HEAD (finding 1). |
| `docs/guides/secrets.md, query-string rule` | A host part listing more than one host (a comma, or `%2C`, as in `a.example,b.example:5432`) is a mismatch as well: libpq tries the hosts in order, so a proof that anchors one of them would not say where the run connects. For the same reason, the environment's libpq names (`PGHOSTADDR`, `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGOPTIONS`, `PGPASSWORD`, `PGPASSFILE`, `PGSERVICE`, `PGSERVICEFILE`) never reach a child that receives a postgres URL: a stale `export PGHOSTADDR=…` would otherwise pick the address libpq connects to, whatever host the proved URL names. | Added to the secrets guide's query-string section (findings 4 and 5). |
| `docs/guides/secrets.md, host kind` | `host` is read as an https host, so `:443` in it is dropped; a value's port is read for the value's own scheme, so only that scheme's default port is dropped (`https://api.example.com:443` is `api.example.com`, `http://api.example.com:443` is not). | Replaces the guide's earlier statement that https's default port is dropped (finding 0). The supabase bullet also now says 'on a single host ending in .pooler.supabase.com'. |
| `docs/guides/updating.md, Version 4 section` | Format version 4 adds the optional `secrets` key; migrating only bumps the version and never writes one. See [Secrets](secrets.md#updating-to-version-4). | New two-line 'Version 4: secrets' pointer. The example output now reads 'already at version 4' (findings 3 and 7). |

## Open questions
- none

## Notes
I fixed every confirmed and plausible finding in review-model-1.json, following the orchestrator's recorded dispositions (decisions 88-94). Gate: `npm test` passes, 31 files and 870 tests. Every commit passed the pre-commit hooks (gitleaks clean, doc-sync PASS); no skip and no --no-verify. I did not run the harness fixture.

- **Finding 4 (P1), commit 46ed5e0.** Added `pgHostProblem` to the core in src/lib/secret/proofs.mjs. A postgres-scheme value whose host part holds `,` or `%2C` is now refused with anchor `hostList`, before either proof kind runs. I tested the raw text for `,` or `%2c` (any case) instead of decoding: libpq decodes only once, so the result is the same and nothing can fail to decode. The supabase pooler anchor is now `POOLER_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com$/`. The near-miss table has the four requested cases. I also added host-kind cases and a direct `check` on a comma host to show the pooler regex alone refuses it.
- **Finding 0 (P2), commit 152f7c2.** The host kind now normalises only `url.hostname` (through canonicalHost) and keeps `url.port` as the parser read it for the value's scheme. `http://` and `ftp://api.example.com:443` are refused; `https://api.example.com:443` passes. One effect, as the disposition specifies: `http://api.example.com` (port 80 dropped as http's default) still matches a declared `api.example.com`, because the kind compares hosts and not schemes. The guide now explains the port reading.
- **Finding 1 (P2), commit 11b6394.** `requireCommittedRecipients` now runs `git ls-files --error-unmatch` (refusing with `removed`) and `git diff --cached --quiet` (refusing with `staged`), in that order, before the work-tree check. Any non-zero exit refuses. Each new refusal has its own message and is tested, including a staged version that differs from both HEAD and the work tree.
- **Finding 5 (P2), commit e7fc004.** The supabase `ambient` and `pointers` lists gain PGHOSTADDR, PGHOST, PGPORT, PGUSER, PGDATABASE and PGOPTIONS. src/lib/secret/config.mjs exports the frozen `LIBPQ_NAMES` (those six plus PGPASSWORD, PGPASSFILE, PGSERVICE and PGSERVICEFILE). A registry test pins every LIBPQ_NAMES entry into the supabase ambient list, with PGPASSWORD the only one that is not a pointer. For s2: the engine still has to drop LIBPQ_NAMES from the child whenever an injected value is a postgres-scheme URL, even with no pack declared. Only the data exists so far, though the guide already states the behaviour.
- **Finding 6 (P3), commit b7ed0ab.** The signature is now `prove(values, proof, kinds, targetNames)`, and the covered set comes from the target's declared names. For s2/s3: plan.md:135 and :155 still show the 3-argument form; callers must pass `target.names`.
- **Findings 3 and 7 (P3), commit 6408cd9.** updating.md now shows `already at version 4` and has a "Version 4: secrets" pointer to secrets.md#updating-to-version-4. I dropped the old "(2026-10-25)" date from the example's caption, since that output was not re-measured; the caption now cites the fixture's check at fixture.sh:370.
- **Finding 2 (P2): no change.** It was already fixed in the orchestrator's commit 121cc49; backlog.md:63 has B-021 under Closed as folded into B-019.

I left the uncommitted state.json change and the .state.json.swp file untouched.
