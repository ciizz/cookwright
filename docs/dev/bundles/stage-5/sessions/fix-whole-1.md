# fix:whole — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `e8e5d99 fix: the age identity is judged by its own real path, not only its directory's`
- `489df6b fix: secrets init removes the identity on failure only when it wrote it`
- `84880a5 fix: age secrets set drops a name the target no longer declares`
- `71d9b12 fix: run reads a URL's whole host before calling it loopback`
- `51e7537 fix: a resolved local-stack URL's public password is no needle on its own`
- `0fb3616 fix: run ends its wait on SIGTERM or SIGHUP once the child has exited`
- `c1dea54 fix: keychain set says a mismatched item remains when deleting it fails`
- `d3053c9 fix: the recipients check passes its path to git as a literal pathspec`
- `c09a065 fix: secrets.carriers leaves a pack's pointer names out`

## Files
- `packages/cookwright/src/lib/secret/backends/age.mjs`
- `packages/cookwright/src/lib/secret/backends/age-init.mjs`
- `packages/cookwright/src/lib/secret/backends/age.test.mjs`
- `packages/cookwright/src/lib/secret/backends/keychain.mjs`
- `packages/cookwright/src/lib/secret/backends/keychain.test.mjs`
- `packages/cookwright/src/lib/secret/envfile.mjs`
- `packages/cookwright/src/lib/secret/envfile.test.mjs`
- `packages/cookwright/src/lib/secret/engine.mjs`
- `packages/cookwright/src/lib/secret/engine.test.mjs`
- `packages/cookwright/src/lib/secret/redact.mjs`
- `packages/cookwright/src/lib/secret/redact.test.mjs`
- `packages/cookwright/src/lib/secret/recipients.mjs`
- `packages/cookwright/src/lib/secret/recipients.test.mjs`
- `packages/cookwright/src/lib/doctor/secrets.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/secrets.mjs`
- `packages/cookwright/src/secrets.test.mjs`
- `packages/cookwright/src/run.test.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `docs/guides/secrets.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.secrets.age.stale` | ${target}: line ${line} of the resolved text sets a name ${target} does not declare (one removed from secrets.targets.${target}.names?); setting any declared name drops it: npx cookwright secrets set ${target} ${name} | run's refusal (exit 125) when an age ciphertext still holds a name the target no longer declares; replaces the old looping 're-set the values' line for that case (finding 5) |
| `messages.secrets.dropped` | secrets: removed ${names} from ${target}'s values, no longer declared | secrets set's line after it dropped stale names from the age ciphertext it wrote back (finding 5) |
| `messages.secrets.keychain.readBackKept` | the keychain returned a different value for ${name} than the one entered, and removing it failed (security delete-generic-password exited ${status}): the item under ${service}, account ${name}, remains with the wrong value; unlock the keychain and set it again, or delete it in Keychain Access | keychain secrets set refusal when the read-back mismatched and the item is still present after the delete (finding 2) |
| `docs/guides/secrets.md identity bullet` | never inside a git work tree, judged by the real path of its directory and, once it exists, of the identity file itself (a `~/.config` symlinked into a dotfiles repo counts as inside it, and so does an `identity.age` linked into one, as GNU stow links files). | secrets guide, age identity location (findings 0 and 6); same idea added to the init checks sentence and the doctor age row |
| `docs/guides/secrets.md age set stale names` | A line of a name the target no longer declares (one you removed from `secrets.targets.<target>.names`) is the exception: `set` drops it from what it writes back and names it (`removed OLD_KEY from dev's values, no longer declared`). Until then `run` refuses the target, naming that line's number and the `secrets set` that drops it. | secrets guide, age secrets set paragraph (finding 5) |
| `docs/guides/secrets.md loopback hosts` | A URL with a password whose host is exactly `localhost`, a `127.x.x.x` address, `[::1]` or `host.docker.internal`, at most followed by a numeric port (the local Supabase stack's `postgres:postgres`), passes that shape check; any other host, `[::1].evil.example` or `127.999.0.1` among them, does not. | secrets guide, 'A value on the command line is refused' (finding 1) |
| `docs/guides/secrets.md redaction local password` | ..., unless it is the local stack's public `postgres` on a loopback host, whose whole URL alone is the needle (so `postgres` the role or database name stays readable, and `-U postgres` is no argument holding the value); / (or its URL-encoded form, or a URL's password, the local stack's public `postgres` excepted) | secrets guide, Redaction paragraph and the argv-check sentence (finding 9) |
| `docs/guides/secrets.md signals` | a SIGTERM or SIGHUP sent to cookwright is passed on to the command, and once the command has exited (with a background process still holding its output) ends `run`'s wait, exiting 128 plus that signal's number. / keeps `run` waiting until that process closes it (or until a SIGTERM or SIGHUP reaches `run`) | secrets guide, exit codes and the redaction paragraph's waiting sentence (finding 8) |
| `docs/guides/secrets.md keychain read-back` | A value that does not come back whole is removed, and nothing is kept; when the keychain refuses that removal (locked, or access denied), the refusal says the item remains with the wrong value, naming its service and account, so you set it again or delete it in Keychain Access. | secrets guide, keychain secrets set paragraph (finding 2) |
| `docs/guides/secrets.md carriers pointers` | A pack's pointer names, which hold no secret (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and libpq's other non-secret settings), are not looked for: exporting them for a local Postgres is fine, and `run` keeps them from its command anyway. | secrets guide, secrets.carriers row (finding 7) |

## Open questions
- none

## Notes
I fixed 10 of the 11 findings, following the recorded dispositions, in 9 commits. Each commit stages named paths only, and finding 6 shares a commit with finding 0. Measured: npm test passes 38 files and 1090 tests (the baseline was 1075). `npx cookwright doctor` on this repo reads 22 checks, all PASS, level 0 complete. I did not run the fixture.

- **Findings 0 and 6 (P1, P2), e8e5d99:** age.mjs has a new `identityWorkTree(identity, env)`. It checks the nearest existing directory as before, and once the identity exists it also checks `path.dirname(fs.realpathSync(identity))`. Both `health()` and init's `preflight()` use it. `enclosingWorkTree` now also drops `GIT_CEILING_DIRECTORIES`. New tests cover a file-level symlink into a second repo for init and for doctor (it FAILs naming that repo's top), plus the ceiling variable.
- **Finding 10 (P3), 489df6b:** `writeIdentity` sets `wrote.identity` once its 'wx' write succeeds, and the catch removes the identity only when that flag is set. The new test writes another run's identity during consent: the EEXIST error passes through unchanged, and that identity is kept. The guide is unchanged, so the commit uses `COOKWRIGHT_SKIP=doc-sync` and gives the reason.
- **Finding 5 (P2), 84880a5:**
  - `parseAgainst` has a new `stale` option. Lines for undeclared names are kept out of `values` and listed in `stale` instead of being refused.
  - age `set` writes back only declared names and returns `dropped`; `secrets set` prints one line for them.
  - `resolve` refuses an undeclared line with `messages.secrets.age.stale`, which names the working `secrets set <target> <first declared name>`.
  - One existing set test switched its bad-ciphertext case from an unknown name to a malformed line, since the unknown name is no longer refused there.
- **Finding 1 (P2), 71d9b12:** `isLoopback` is now one anchored regex: localhost, host.docker.internal, `[::1]` or 127/8 with each octet 0 to 255, then at most a numeric port. One behaviour change: `localhost:` with an empty port is no longer loopback, which errs on the refusing side.
- **Finding 9 (P3), 51e7537:**
  - `needles(values, inherited, publicUrl)` takes a predicate. The engine passes `publicLocalUrl`, which is exported and also used by `publicLocal`.
  - For a local-stack URL, the password `postgres` is no longer a needle on its own; the whole URL still is. To avoid a circular import, redact.mjs gets the predicate as an argument instead of importing it from the engine.
- **Finding 8 (P3), 0fb3616:** a new `signalHandlers(child)` helper in the engine. Once the child has exited, SIGTERM or SIGHUP destroys both pipes and resolves the wait with 128 + n. SIGINT stays ignored, as the disposition says. I checked that the new run.test case fails without this fix.
- **Finding 2 (P2), c1dea54:** after a read-back mismatch, keychain `set` deletes the item and then looks it up again. If the item is still there, the new `readBackKept` refusal names the service, the account and the delete's exit status.
- **Finding 3 (P3), d3053c9:** both git calls in `requireCommittedRecipients` now run with `--literal-pathspecs`. The new test uses an `a[1]` config root with a staged `a1` sibling, and fails without the fix. The guide is unchanged, so this commit also uses `COOKWRIGHT_SKIP=doc-sync` with the reason.
- **Finding 7 (P3), c09a065:** `checkSecretsCarriers` leaves out `pointerNames(config)`. PGPASSWORD, SUPABASE_DB_URL and SUPABASE_ACCESS_TOKEN are still reported.
- **Finding 4 (P3), declined with no edit:** this follows the orchestrator's recorded disposition. The bundle directory is never edited by hand, and B-022 already tracks the scrubber gap.

Every commit with a guide implication updates docs/guides/secrets.md in the same commit, and the strings list covers all of those edits. Nothing ran that leaves the repo.
