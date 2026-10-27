# fix:engine — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `0f76675 fix: only the local stack's public default escapes the inherited needles (findings 3, 6)`
- `7b1b834 fix: doctor's secrets.backend SKIPs without git instead of failing (finding 7)`
- `bc50429 fix: op inject reads each reference inside {{ }} (finding 8)`
- `635ab42 fix: age secrets set checks the existing ciphertext before asking for the value (finding 1)`
- `f7d3110 fix: secrets init's rollback removes only the empty directories it made (finding 2)`
- `588d3a5 fix: the hidden prompt refuses a control character instead of dropping it (finding 5)`
- `9678b5d feat: secrets init enrols a second repo with the developer's existing age identity (finding 4)`
- `e456859 test: the fixture's first init runs isolated, like its doctor runs (implement:s3 open question 6)`

## Files
- `packages/cookwright/src/lib/secret/engine.mjs`
- `packages/cookwright/src/lib/secret/engine.test.mjs`
- `packages/cookwright/src/run.test.mjs`
- `packages/cookwright/src/lib/doctor/registry.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/lib/secret/backends/onepassword.mjs`
- `packages/cookwright/src/lib/secret/backends/onepassword.test.mjs`
- `packages/cookwright/src/lib/secret/backends/age.mjs`
- `packages/cookwright/src/lib/secret/backends/age-init.mjs`
- `packages/cookwright/src/lib/secret/backends/age.test.mjs`
- `packages/cookwright/src/lib/secret/prompt.mjs`
- `packages/cookwright/src/lib/secret/prompt.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/secrets.test.mjs`
- `packages/cookwright/skills/setup/SKILL.md`
- `docs/guides/secrets.md`
- `scripts/ci/fixture.sh`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.secrets.prompt.control` | the value holds a tab or another control character (an arrow key sends one), which the hidden prompt cannot take as typed; pipe it as one line with --stdin; nothing written | secrets set at the hidden prompt, refused at Enter (finding 5) |
| `messages.secrets.age.identityNotFile` | ${p} exists and is not a file, so it is no age identity; nothing written | secrets init preflight when the identity path is a directory or similar (finding 4) |
| `messages.secrets.age.noDerivedKey` | age-keygen -y read no single age1… public key from the identity at ${p} (its output is not shown, since it may quote the key); nothing written | secrets init enrolling a repo, deriving the existing identity's key failed (finding 4) |
| `messages.secrets.age.willUse` |   no identity: the one at ${p} is yours already (one per developer), and its public key is read from it[ (age asks for its passphrase next, on this terminal)] | secrets init consent lines with an existing identity; the bracketed part only for a passphrase-protected one (finding 4) |
| `messages.secrets.age.usedIdentity` | secrets: read the public key of ${p}; the identity is unchanged | secrets init after enrolling a repo (finding 4) |
| `messages.secrets.age.alreadyHeld` | secrets: ${rel} already holds this identity's public key; nothing written | secrets init when the recipients file already holds the existing identity's key (finding 4) |
| `messages.secrets.age.held (changed)` | ${rel} already holds ${n} recipient(s) (…): one identity per developer, so on a second machine copy your identity there rather than make a new one; a new recipient cannot read what is already encrypted until each value is set again | secrets init consent; 'instead of running init' became 'there rather than make a new one', since init now enrols an existing identity |
| `messages.secrets.age.identityExists (removed)` | (removed) an age identity already exists at <path>; one identity per developer, so init writes none … | init no longer refuses an existing identity (finding 4) |
| `docs/guides/secrets.md run section` | … (8 characters or more, unless it is the local Supabase stack's public default: a URL on a loopback host whose password is `postgres`, or `PGPASSWORD=postgres`; any other loopback URL, such as a tunnel to production on `localhost`, is still refused) … / … replaced too, the local stack's public default excepted. | the argv-check and redaction sentences, narrowed (findings 3, 6) |
| `docs/guides/secrets.md 1Password section` | `run` hands `op inject` the reference lines alone, on stdin, each reference inside `{{ }}` (written by `run`, not in the file), so `op` sees no comment and nothing else of the file and reads a vault or item name holding a space whole, … | finding 8 |
| `docs/guides/secrets.md age set` | When the target already has a ciphertext, it is decrypted and checked first (age asks for a protected identity's passphrase then), so an identity that cannot open it, or contents that are not the declared lines, refuse before you type the value. | finding 1 |
| `docs/guides/secrets.md age set prompt` | The hidden prompt takes printable characters and backspace; a tab or any other control character (an arrow key sends one) refuses the value rather than store it altered, so a value holding a tab goes through `--stdin`. | finding 5 |
| `docs/guides/secrets.md keychain set` | A value holding a non-ASCII character, or a tab given with `--stdin`, comes back as given: cookwright reads items with `find-generic-password -g`, … | finding 5, the tab sentence limited to --stdin |
| `docs/guides/secrets.md init` | … writes nothing when a check fails: the identity's directory outside every work tree, … When an identity is already there, `init` writes none: it enrols this repo with it (see "One identity per developer" below). | finding 4 |
| `docs/guides/secrets.md one identity per developer` | In a second repo on the same machine, run `npx cookwright secrets init` there too: it finds your identity, writes no new one, reads its public key (`age-keygen -y`; for a passphrase-protected identity, age asks for the passphrase on your terminal and the key is read in memory only) and appends it to that repo's `secrets/recipients.txt`, after the same checks and the same question; commit the file before the first `set`. When the file already holds that key, it writes nothing. On a second machine, copy your identity (passphrase-protected, outside any repo) to the same place instead of making a new one; `init` there then finds it the same way. | finding 4 |
| `skills/setup/SKILL.md secrets.targets row` | | WARN | `secrets/recipients.txt not found; npx cookwright secrets init writes it` | hand the developer `npx cookwright secrets init`: with an identity already on this machine (from another repo), it writes no identity and adds that identity's public key here; then the commit of `secrets/recipients.txt`, theirs | | finding 4, the setup recipe for a second repo |

## Open questions
- Finding 3 (P2): only the developer can rule on how narrow the exemption is. As fixed, an inherited value escapes the needles only when it is the local stack's public default: a URL on a loopback host whose percent-decoded password is exactly `postgres`, or PGPASSWORD=postgres. Every other loopback URL is a needle again, including a local SUPABASE_URL with no password (http://127.0.0.1:54321), so passing it on the argv is refused. That matches the orchestrator's disposition, which corrected its own s2 open question 4 and is pending the developer's ruling.
- Finding 0 (P2 confirmed): not changed, following the orchestrator's disposition. On a real terminal age 1.3.2 prints its autogenerated passphrase to the terminal it opened, not to stderr. Refusing an empty passphrase would mean cookwright handling the passphrase, and a pseudo-terminal test needs a dependency. The consent line and the guide say an empty passphrase makes age generate one and print it once. The developer rules on this at the strings batch.
- Finding 4: for an unprotected identity the public key is derived with `age-keygen -y <identity path>` (the path as an argument), not with the identity piped on stdin as the disposition wrote. The secret key never enters cookwright's memory this way; the outcome is the same. A passphrase-protected identity follows the disposition: `age -d <identity>` into memory (age prompts, uncapped), then `age-keygen -y` on stdin. Confirm the path-argument choice.

## Notes
I fixed seven findings (1, 2, 3, 4, 5, 6, 7) plus orchestrator open question 6, one commit per logical fix, staging named paths only. The fix for finding 8 is also committed but not yet tested against a real op (below). I declined two findings, as the orchestrator disposed them. Finding 0 is in open_questions. Finding 9 (P3 plausible): no edit. The fragment in the session report names only the system temp folder and the fixture's random suffix, nothing that identifies the machine. The bundle directory is also never edited by hand, so this is left as closeout residue.

How each fix was done:
- **Findings 3 and 6** (engine.mjs): `inheritedValues` now drops only values where `publicLocal(name, value)` holds, meaning a loopback URL whose password is `postgres`, or PGPASSWORD=postgres. Any other inherited loopback URL is a needle again for both the argv check and the redactor. The URL-with-password shape exemption for loopback hosts (amendment 43) is unchanged. Tests:
  - the tunnel URL `postgres.<ref>:<pw>@localhost:5433` is refused, in the engine test and in run.test;
  - `postgres:postgres@127.0.0.1:54322` passes;
  - with PGPASSWORD=postgres, `psql -U postgres` passes.
  The guide's two sentences are narrowed.
- **Finding 7**: `secrets.backend` is registered with `git: true`, so a machine without git reads SKIP `skipped, needs git, run setup`, which the setup skill's any-check row already covers. Tested.
- **Finding 8**: each reference goes to op inject as `NAME={{ op://… }}`; the file's grammar is unchanged. Not measured with a real op: an unsigned op inject blocks on auth. The developer's QA run should include a vault name with a space.
- **Finding 1**: age `set` now decrypts and parses before `ctx.readValue()`. A test checks the call order (-d, ask, -a) and that bad contents and a failing decrypt both refuse without asking for the value. The guide says so.
- **Finding 2**: init records the directories `mkdir -p` creates and rolls back with `rmdirSync`, deepest first, stopping at the first one that is not empty. A test plants a foreign file mid-init and checks it survives.
- **Finding 5**: at the hidden prompt, any control character (a tab, ESC, and so on) marks the line, which is read to its end and then refused at Enter with the new `prompt.control` line naming --stdin. Reading to the end means the rest of the typed value never reaches the shell. A tab through --stdin still goes through (tested). The guide's tab sentences are limited to --stdin.
- **Finding 4**: with an identity already present, init skips the identity write and enrols the repo after the same preflight and consent. A protected identity needs a terminal and is refused without one by the existing protectedNoTerminal line. If the key is already held, nothing is written. age-keygen's error is never printed because it may quote the key. A path that is not a file is refused. `identityExists` is removed. Tested with fakes for both paths, the already-held case, a key that cannot be derived, and declining consent. There is also a real-age test: a second repo on the same identity gets the same recipient, a second init writes nothing, and set and run work there.
- **Open question 6**: the fixture's first `npx cookwright init` runs through `isolated`.

Measured:
- `npm test`: 38 files, 1067 tests, all green (baseline 1048).
- `bash scripts/ci/fixture.sh` locally, with age, gitleaks and supabase on PATH: PASS. The first doctor run had 31 checks: 30 PASS, 1 WARN. The second (secrets step) had 27 PASS, 4 WARN. In init's readout, secrets.carriers now reads PASS where it used to name the host's export.

Every commit passed the pre-commit hooks with no doc-sync escape. I did not touch state.json or the untracked `.state.json.swp`.
