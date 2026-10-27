# implement:s5 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `d01e8f5 docs: the guides, README and Layout name secrets and doctor's 22 rows`
- `509070a chore: a secrets doc-sync rule ties run and the secrets modules to their guide`
- `005959a chore: backlog closes E-015 and opens stage 5's deferrals`

## Files
- `README.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `cookwright.json`
- `docs/guides/getting-started.md`
- `docs/guides/hooks-and-escapes.md`
- `docs/guides/updating.md`
- `docs/guides/secrets.md`
- `docs/dev/backlog.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `README tagline` | Built for solo developers, with stack packs for Expo and Supabase, and a way to run a command with its credentials that never writes one to a plaintext file. | README.md opening paragraph (replaces 'secure credential handling is on the way') |
| `README What you get: doctor count` | A session-start hook runs 22 checks, plus four for each stack pack you declare (five for Supabase), … | README.md What you get, first bullet (19 -> 22) |
| `README What you get: secrets bullet` | **Secrets that never touch disk in plaintext.** `npx cookwright run dev -- npm run seed` reads the `dev` target's values from a backend (`age`, the macOS keychain or 1Password), checks they point at the project the target names (the Supabase ref, or a host), and injects them into that one command, with a value on its command line refused and its output redacted. No `.env`, not even as a fallback; off until you declare a backend. See [Secrets](docs/guides/secrets.md). | README.md What you get, new bullet |
| `README Quick start readout` | (16 steps, every file named, then doctor's 22 lines) / 22 checks — 22 PASS, 0 FAIL, 0 WARN, 0 SKIP | README.md Quick start output block |
| `README Guides: secrets link` | [Secrets](docs/guides/secrets.md): targets, the `age`, keychain and 1Password backends, the proofs, `npx cookwright run`, what doctor checks and what is not covered. | README.md Guides list, new entry |
| `README Status rows` | | Level 2: secrets (`run`; `age`, keychain and 1Password backends) | experimental; not on npm yet (after 0.2.1) | and | Level 2: Supabase ops, OTA preflight | not available yet | | README.md Status table, the Level 2 secrets row split from Supabase ops / OTA |
| `getting-started intro` | The output below is real: cookwright at the version that adds secrets, installed from its `npm pack` tarball into a fresh git repo whose `package.json` has a test script, on 2026-10-27, with Claude Code 2.1.311 and gitleaks 8.30.1 on PATH. Your paths and versions will differ. | docs/guides/getting-started.md first paragraph; the init, commit and doctor blocks re-measured to match (docs-audit skill line, 22 rows, 31 with both packs) |
| `getting-started secrets rows sentence` | The last three of the 22, `secrets.backend`, `secrets.targets` and `secrets.carriers`, read PASS while no secrets backend is declared, except that `secrets.carriers` WARNs, even then, an `.envrc` or a name a declared pack's tools read on their own (`SUPABASE_DB_URL`) exported in your shell or set in its rc files; once you declare a backend they check its setup, its files and your shell by name, and no level requires them either (see [Secrets](#secrets-level-2-off-until-you-declare-a-backend)). | docs/guides/getting-started.md step 4 paragraph |
| `getting-started Secrets section` | ## Secrets (Level 2): off until you declare a backend — cookwright never writes a secret to a plaintext file. A command that needs one (a seed script, a migration against a hosted database) runs through `npx cookwright run <target> -- <command>`, which reads the target's values from a backend (`age`, the macOS keychain or 1Password), checks that they point at the project the target names, and injects them into that one command. Until `cookwright.json` declares a backend, `run` refuses and starts nothing, exit 125 (2026-10-27, the repo above): [run's refusal line]. Setting one up, the backends, the proofs and what is not covered: [Secrets](secrets.md). Ask your agent to set up secrets and the setup skill walks it with you; the commands that read a value or a passphrase are yours to type. | docs/guides/getting-started.md new section before 'Trying an unpublished change' |
| `hooks-and-escapes No escape for run` | ## No escape for `run` — `COOKWRIGHT_SKIP` and `--no-verify` reach the git hooks only. `npx cookwright run <target> -- <command>` (see [Secrets](secrets.md)) has no escape: it takes no flag of its own and reads no skip variable, so a refusal (a declared name the backend lacks, a proof that fails, a value on the command line) always exits 125 with one line naming the fix, and the command does not start. The fix is in the config, the backend or the command; the alternative a skip would offer, the value in your shell or on a command line, is what `run` exists to prevent. | docs/guides/hooks-and-escapes.md new section after Escapes |
| `updating version 4 paragraph` | The version that brings it also ships version 4 of the managed rules block, whose Secrets section gains the agent's rules for `npx cookwright run`, so doctor FAILs `rules.block` (`AGENTS.md: the managed block is stale (run npx cookwright init)`) until `npx cookwright init` refreshes it; commit `AGENTS.md`. Doctor also gains three rows, after `packs` and before any pack's own rows: `secrets.backend`, `secrets.targets` and `secrets.carriers`. With no `secrets` key they read PASS (`no backend (Level 2 off)`, `no targets declared`), except that `secrets.carriers` WARNs an `.envrc`, or a name the declared packs' tools read (`SUPABASE_DB_URL`) exported in your shell or set in its rc files; no level requires them. Nothing else changes until you declare a backend. | docs/guides/updating.md, Version 4: secrets |
| `secrets guide rows position` | Three rows, after every row a level requires (after `packs`, before a declared pack's own rows), so a slow keychain never costs a required row its time. | docs/guides/secrets.md What doctor checks, first sentence (was 'last in the readout', wrong when a pack is declared) |

## Open questions
- Outside the declared files: CONTRIBUTING.md line 31 said 'two doc-sync rules' (it was already stale at four), and the new rule makes five. I updated it in the cookwright.json commit because the change has a doc implication, and it is one line. Confirm that is acceptable.
- Outside s5's own guides: docs/guides/secrets.md (s4's file) said the three secrets rows sit 'last in the readout'. That is wrong when a pack is declared: the fixture measured them between `packs` and `pack.expo.declared`. I corrected the one sentence in checkpoint 1.
- The README status row reads 'experimental; not on npm yet (after 0.2.1)'. At release it should name the version. The getting-started intro says 'the version that adds secrets, installed from its npm pack tarball'. The tarball's package.json still says 0.2.1, so the guide names no version number. Relabel both when the release is cut.
- E-051 was never used in the backlog history. I kept to the next number after the highest id, so the openings are E-057 to E-068 and B-022.

## Notes
s5 is done. Three checkpoints are committed, each staged by named paths. Before trusting the hook reports I checked that core.hooksPath is .githooks. Every pre-commit ran: secrets PASS (gitleaks 8.30.1) and doc-sync PASS, no skip used.

**Checkpoint 1: guides, README, AGENTS.md Layout (d01e8f5)**
- getting-started's output was re-measured on 2026-10-27. I installed the `npm pack` tarball of this branch into a fresh scratch git repo that has a test script, with claude 2.1.311 and gitleaks 8.30.1 on PATH.
  - init now prints 16 lines, including `.claude/skills/docs-audit`, which the old block lacked.
  - The commit through the hooks: 16 files, 180 insertions.
  - doctor: 22 checks, 22 PASS, level 0 complete.
  - With claude and gitleaks off PATH: 22 checks, 20 PASS, 2 SKIP, `not verified: host.rules, tools.gitleaks`.
  - The Expo rows come from this session's fixture run: 31 checks, 30 PASS, 1 WARN, with the secrets rows between `packs` and `pack.expo.declared`.
  - A new Secrets section shows `run dev -- true` refusing with exit 125 when no backend is declared. The text was measured.
- hooks-and-escapes gains "No escape for run". I checked that run.mjs uses onlyFlags(flags, []) and that neither run nor the secret modules read COOKWRIGHT_SKIP.
- updating's version 4 section now names the v4 block, whose stale state is a doctor FAIL, and the three new rows.
- README:
  - the tagline;
  - the doctor count, 19 to 22;
  - a secrets bullet;
  - the Secrets guide link;
  - the Level 2 status row split into "secrets: experimental, not on npm yet" and "Supabase ops, OTA preflight: not available yet".
- AGENTS.md Layout now names src/lib/secret/ (singular) and why, doctor's src/lib/doctor/secrets.mjs, the fixture's secrets step, CI's sha256-pinned age 1.3.2 with FIXTURE_STRICT, and the macOS real-keychain test.
- Disposition 41 checked in code:
  - spawnChild sets shell: false;
  - age health returns SKIP 'permissions not measured on this platform' on win32;
  - keychain declares platforms ['darwin'].
  - The guides claim nothing more for Windows; README still lists Windows as not supported.

**Checkpoint 2: dogfood (509070a)**
- cookwright.json gains the docSync rule `secrets`: run.mjs, secrets.mjs, src/lib/secret/**, src/lib/doctor/secrets.mjs and ':!*.test.mjs', mapped to docs/guides/secrets.md.
- Through git diff pathspecs (the hook's own mechanism), it matches 15 files and no test.
- The hook reports '5 rule(s) checked'.
- Doctor on this repo: 22 checks, 22 PASS, level 0 complete. secrets.backend reads 'no backend (Level 2 off)', secrets.targets 'no targets declared', secrets.carriers PASS.
- This repo was already at config version 4 since s1.

**Checkpoint 3: backlog (005959a)**
- E-015 moved to Closed. Its evidence is the fixture's secrets step, where secrets.carriers WARNed 'a line setting SUPABASE_DB_URL in ~/.zshrc'.
- E-001 now notes the PG* derivation inside run (disposition 27).
- Opened E-057 to E-068, plan §9 and its §11 residue:
  - a JWT ref proof;
  - multi-line values;
  - a configurable secrets directory;
  - public: true;
  - secrets rekey;
  - an identity unlock cache;
  - signed ciphertext;
  - a Linux secret-service backend;
  - a Windows Credential Manager backend;
  - the re-exec;
  - run --check;
  - the keychain search list.
- Opened B-022, the bundle scrubber's blind spot for a bare `/var/folders` head.
- backlog.ids: 89 ids, each once.

**Checkpoint 4: npm pack --dry-run (measured, nothing to commit)**
- The listing has 106 files, package size 212.7 kB.
- It includes src/lib/secret/{config,engine,envfile,prompt,proofs,recipients,redact}.mjs and src/lib/secret/backends/{age,age-init,index,keychain,onepassword}.mjs, plus src/run.mjs, src/secrets.mjs, src/lib/doctor/secrets.mjs and schema/cookwright.schema.json.
- Zero entries match test-fixtures, *.test.mjs or test-helpers.

**Measured at session end**
- npm test: 38 files, 1070 tests, all passed.
- `bash scripts/ci/fixture.sh`: PASS, run at session start on unchanged code with age, gitleaks and supabase on PATH. Its three readouts: init 31/30 PASS/1 WARN, doctor the same, secrets-step doctor 31/27 PASS/4 WARN. The session's commits after that run are docs, config and backlog only.

**Untouched**
The tree still has the orchestrator's modified docs/dev/bundles/stage-5/state.json and an untracked .state.json.swp beside it. I did not touch either.

**Scratch files**
- The tarball listing is in <local path>
- The fixture output is in <local path> It holds machine-local temp paths; never commit it.

**The developer's hands (not run)**
- The release in plan §9's order, from packages/cookwright: `npm version 0.3.0`, then `npm publish` (npm login first, since the stored token is stale).
- Then `git push origin main --follow-tags` after the merge.
