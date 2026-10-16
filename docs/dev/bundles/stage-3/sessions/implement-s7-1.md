# implement:s7 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `9f0eed9 test(ci): the harness fixture on a pinned create-expo-app scaffold`
- `2999c15 ci: the test matrix and the fixture job (E-014 narrowed)`

## Files
- `scripts/ci/fixture.sh`
- `fixtures/expo-overlay/AGENTS.md`
- `.github/workflows/ci.yml`
- `AGENTS.md`
- `docs/dev/backlog.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `fixture.sh MSG_HEAD` | fixture: create-expo-app@$CREATE_EXPO_APP_VERSION, template $TEMPLATE | the script's first output line, printing both pinned versions (create-expo-app@5.0.0, template expo-template-blank-typescript@58.0.21) |
| `fixture.sh MSG_SKIP` | fixture: skipped, needs %s, run setup | local run with git, npm or npx missing; exits 0 (in CI the run fails instead) |
| `fixture.sh MSG_FAIL` | fixture: FAIL: %s | any failed assertion; exit 1. The reasons: 'needs <tool>' (CI only), 'the scaffold wrote no <file>', 'init row missing: <regex>', 'init exited non-zero', "init lost the scaffold's AGENTS.md text", "init lost the overlay's rule", "init lost the scaffold's settings", 'doctor exited non-zero', 'level 0 is not complete', 'doctor reported a FAIL or a WARN', 'gitleaks is on PATH but tools.gitleaks is not PASS', 'core.hooksPath is not .githooks', 'the commit was refused', 'the pre-commit hook did not run', 'the tree is dirty after the commit', 'changelog --check exited non-zero', 'migrate exited non-zero', 'migrate did not read version 2', 'a second init exited non-zero', 'a second init changed the tree', '<link> is not a link', '<link> does not resolve' |
| `fixture.sh MSG_DIR` | fixture: working in %s | the temp dir; removed on exit unless KEEP=1 |
| `fixture.sh MSG_STEP` | == <step name> | step headers: 'npm pack', 'create-expo-app', 'overlay, git init, one commit', 'npm install --save-dev <tarball>', 'npx cookwright init', 'npx cookwright doctor', "commit init's files through the hooks", 'npx cookwright changelog --check, migrate, init again', 'ls -la .claude/skills .claude/workflows' |
| `fixture.sh MSG_OK` | fixture: PASS, every step as expected | the last line of a green run |
| `fixtures/expo-overlay/AGENTS.md` | ## My rules

- A screen file stays under 200 lines; split a longer one into components under `src/components/`. | the user's own rule, appended to the scaffold's AGENTS.md |
| `ci.yml step name` | gitleaks, from the pinned release tarball, sha256 checked | fixture job step name; the job names are 'test (<os>, node <n>)' and 'fixture' |
| `AGENTS.md Layout line` | `scripts/ci/fixture.sh` — the harness fixture, `bash scripts/ci/fixture.sh`: a pinned `create-expo-app` scaffold with `fixtures/expo-overlay/` appended, the package installed from its `npm pack` tarball, then init, doctor, a commit through the hooks, changelog and migrate run against it. The pinned versions are bumped deliberately, by hand. `.github/workflows/ci.yml` runs `npm test` (ubuntu and macOS, Node 20 and 22) and the fixture (ubuntu, gitleaks from its pinned release). | this repo's AGENTS.md Layout section, outside the managed block |
| `backlog E-014` | … Narrowed 2026-10-16 by stage 3: `scripts/ci/fixture.sh`, `fixtures/expo-overlay/` and `.github/workflows/ci.yml` landed, the fixture measured locally; open for the first green GitHub run and `ci: { workflow: "ci.yml" }` set in `cookwright.json`, the developer's hands after the first push. | docs/dev/backlog.md, E-014's narrowed line (plan §9) |

## Open questions
- Two pins, not one. The plan says one constant, but create-expo-app 5.0.0 resolves `--template blank-typescript` to whatever expo-template-blank-typescript is latest on npm, so pinning only the CLI would still let an Expo SDK release turn CI red. The script pins both: CREATE_EXPO_APP_VERSION=5.0.0 and TEMPLATE=expo-template-blank-typescript@58.0.21. Both are printed on the first line. The floating and pinned scaffolds came out byte-identical today (diff -r, .git excluded). Is that acceptable as a formal reading of the developer's amendment, or should it be recorded with `bundle decide`?
- Expo 58 / react-native 0.88 require Node ^22.13. Locally, on Node 20.19.4, npm install printed EBADENGINE warnings but succeeded. The fixture job uses Node 22 for this reason. The test matrix keeps Node 20 and 22, per the plan.
- Beyond the plan's list, the script also checks that a second `npx cookwright init` leaves the tree clean, and that init kept the scaffold's AGENTS.md text, the overlay rule and the scaffold's `.claude/settings.json` enabledPlugins. The reviewer may want these removed as scope.
- AGENTS.md Layout gained one line for scripts/ci/ and ci.yml, under the 'when unsure, update the doc' rule. Plan §9 did not list it.
- The scaffold also writes `.claude/settings.json` with `enabledPlugins: {"expo@claude-plugins-official": true}`, and init's hook step merged into it and kept it. A `--no-agents-md` flag exists that skips AGENTS.md, CLAUDE.md and the settings file. The fixture does not exercise that path.

## Notes
The fixture runs green locally. Both checkpoints are committed: 9f0eed9 has the script, the overlay and the AGENTS.md line; 2999c15 has ci.yml, the E-014 narrowing and the AGENTS.md line extended for ci.yml. `ci.workflow` is still unset in `cookwright.json` (disposition 8).

**Scaffold, measured from the registry on 2026-10-16**
- create-expo-app dist-tags: latest = shim = 5.0.0 (published 2026-09-10). The previous release is 4.0.0 (2026-05-15).
- expo-template-blank-typescript: latest = sdk-58 = 58.0.21.
- `npx --yes create-expo-app@5.0.0 app --template blank-typescript --no-install --yes` writes these files: .claude/settings.json (only `enabledPlugins: {"expo@claude-plugins-official": true}`), .gitignore, AGENTS.md (the Expo guidance, first line "This is an Expo/React Native mobile application…"), CLAUDE.md (`@AGENTS.md`), app.json, App.tsx, assets/ (android-icon-background, android-icon-foreground, android-icon-monochrome, favicon, icon, splash-icon .png), index.ts, LICENSE, package.json (expo ~58.0.12, react 19.3.0, react-native 0.88.0, typescript ~6.0.3), tsconfig.json.
- The scaffold also runs `git init` and makes an "Initial commit" itself.
- The plan's three expected files (AGENTS.md, CLAUDE.md holding @AGENTS.md, .claude/settings.json) are confirmed.

**The script, `scripts/ci/fixture.sh`** (bash 3.2-safe, committed executable). In order:
1. Prints the pins on the first line.
2. Checks for git, npm and npx. Locally a missing one means "skipped, needs X, run setup" and exit 0; with CI set it fails.
3. Isolates git: GIT_CONFIG_GLOBAL=/dev/null, NOSYSTEM, init.defaultBranch=main through GIT_CONFIG_COUNT, and a fixture@example.invalid identity.
4. Runs `npm pack` of the workspace into a mktemp dir.
5. Scaffolds, appends `fixtures/expo-overlay/AGENTS.md`, runs `git init` only if the scaffold did not, and makes one commit.
6. Runs `npm install --save-dev <tarball>`.
7. Runs `npx cookwright init` and checks its rows: wrote cookwright.json, updated AGENTS.md, kept CLAUDE.md, updated .claude/settings.json, wrote each of the 4 pointers, wrote both shims.
8. Runs doctor: exit 0, "level 0 declared: complete", "0 FAIL, 0 WARN", and tools.gitleaks PASS when gitleaks is on PATH.
9. Checks core.hooksPath, then commits through the real hooks and expects a pre-commit secrets line and a clean tree.
10. Runs `changelog --check`, `migrate` (expects "already at version 2"), and init a second time (tree must stay clean).
11. Runs `ls -la` and checks every pointer is a link that resolves.

**Local run, once**: Node 20.19.4, gitleaks 8.30.1, `TMPDIR=<scratchpad>/s7 KEEP=1 bash scripts/ci/fixture.sh`, exit 0. Key output:
```
fixture: create-expo-app@5.0.0, template expo-template-blank-typescript@58.0.21
== npm pack            -> cookwright-0.0.0.tgz, 69 files, 114.2 kB
== create-expo-app     -> the 16 files above
== overlay, git init, one commit -> 21c19ec fixture: the scaffold with the overlay / 1624a80 Initial commit
== npm install         -> added 460 packages in 8s (EBADENGINE warnings: expo 58 wants node ^22.13)
== npx cookwright init -> wrote cookwright.json, docs/backlog.md, docs/closeouts/, CHANGELOG.md; updated AGENTS.md (block appended, your text untouched); kept CLAUDE.md; updated .claude/settings.json (hook added, other settings kept); wrote .claude/skills/{bundle,setup}, .claude/workflows/{bundle-phase,docs-audit}.js; updated .gitignore; wrote hooks.path, .githooks/pre-commit, .githooks/pre-push
== npx cookwright doctor -> 17 checks — 17 PASS, 0 FAIL, 0 WARN, 0 SKIP / level 0 declared: complete
== commit through the hooks -> pre-commit PASS secrets (gitleaks 8.30.1); pre-commit SKIP doc-sync (no rules); [main ad9ab77] chore: cookwright init, 15 files
== changelog --check   -> CHANGELOG.md: up to date (0 release tag(s)); migrate -> cookwright.json: already at version 2; second init left the tree clean
== ls -la              -> bundle -> ../../node_modules/cookwright/skills/bundle, setup -> ../../node_modules/cookwright/skills/setup, bundle-phase.js and docs-audit.js -> ../../node_modules/cookwright/hosts/claude/workflows/…
fixture: PASS, every step as expected
```
The full log is at <local path> My `rm -rf` of the kept temp dir was denied, so <local path> (with its node_modules) is still there and can be deleted.

**`.github/workflows/ci.yml`**
- Triggers: push to main, pull_request, workflow_dispatch. Permissions: contents: read.
- `test` job: ubuntu-latest and macos-latest × node 20 and 22, fail-fast off, `npm ci` then `npm test`.
- `fixture` job: ubuntu-latest, node 22. gitleaks 8.30.1 comes from the linux_x64 release tarball, checked against sha256 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb. I got that hash from the release's checksums file and recomputed it on the downloaded tarball. The job then runs `bash scripts/ci/fixture.sh`.
- Actions are pinned by commit, both resolved with `gh api` today: actions/checkout 3d3c42e5aac5ba805825da76410c181273ba90b1 (v7.0.1, 2026-07-20) and actions/setup-node 820762786026740c76f36085b0efc47a31fe5020 (v7.0.0, 2026-07-14). I skipped setup-node v7.1.0 because it is under two weeks old.
- No Windows job (disposition 9). The YAML parses (Ruby YAML). actionlint is not installed here, so it was not linted.

**Suite and doctor**: on this repo `npm test` gives 17 files and 469 tests passed. Doctor reads 17 PASS, level 0 complete.

**The developer's hands, not run**: `git remote add origin <url>` and the first `git push`, which is the first CI run. Then set `"ci": { "workflow": "ci.yml" }` in `cookwright.json` and close E-014 on the green run.
