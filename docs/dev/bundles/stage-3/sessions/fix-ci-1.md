# fix:ci — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `be43723 fix(ci): run the workflow on a pushed bundle branch`
- `51bc551 fix(ci): the fixture asserts the scaffold's plugin entry survives init`
- `f80fde0 fix(ci): the fixture starts from a fresh repo of the app's own`
- `06b7e02 fix(ci): with gitleaks on PATH the fixture requires the hook's scan to PASS`
- `dd6b6e9 fix(ci): a missing tool skips the fixture unless the workflow asks for strict`
- `536f4c5 fix(ci): the fixture installs without lifecycle scripts and says its tree floats`

## Files
- `.github/workflows/ci.yml`
- `scripts/ci/fixture.sh`
- `AGENTS.md`
- `docs/dev/backlog.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `fixture.sh fail (overlay)` | the app is not its own repo | MSG_FAIL reason added in overlay(): after rm -rf .git and git init, the app directory is not git's top level |
| `fixture.sh fail (commit_through_hooks)` | gitleaks is on PATH but the hook's secrets scan is not PASS | MSG_FAIL reason added: when gitleaks is on PATH, the commit's pre-commit secrets line has to be PASS |
| `fixture.sh fail (need)` | needs <tool> | Existing MSG_FAIL reason. It now fires only when FIXTURE_STRICT=1, which the ci.yml fixture job sets. Before, it fired whenever CI was nonempty. Otherwise the script prints MSG_SKIP and exits 0 |
| `AGENTS.md Layout line` | `.github/workflows/ci.yml`, on a push to `main` or a `bundle/**` branch and on a pull request, runs `npm test` ...; ... The pinned versions are bumped deliberately, by hand; the scaffold's dependency tree is not pinned and floats within its ranges (E-036). | This repo's AGENTS.md Layout section, outside the managed block. It now names the CI triggers and says the dependency tree floats |
| `backlog E-036` | A committed lockfile for the fixture's scaffold in `fixtures/expo-overlay/`, installed with `npm ci` before the tarball, so the dependency tree `scripts/ci/fixture.sh` installs is pinned like the scaffold's files; regenerated with each scaffold bump. Needs a networked run to generate. Found by review:ci of stage-3. | New entry under Open enhancements in docs/dev/backlog.md |

## Open questions
- Finding 4 (the scaffold's dependency tree floats): I applied the suggested alternative fix. The install now runs with --ignore-scripts, and the script header and the AGENTS.md line say the tree floats. The stronger fix is a committed lockfile in fixtures/expo-overlay/ installed with npm ci, and I logged it as E-036. I could not generate the lockfile because the sandbox denied a direct npx/npm lockfile run outside the script. Should this bundle commit the lockfile before closing, with the developer generating it (`npm install --package-lock-only --ignore-scripts` in a scaffold made by the pinned create-expo-app), or does it wait for E-036?

## Notes
I fixed all 7 findings in review-ci-1.json and declined none.
- #3 (confirmed): ci.yml now also runs on a push to 'bundle/**', so `bundle check`'s `gh run list --commit` can find a run on the bundle branch's HEAD.
- #0 (confirmed): the settings check now parses .claude/settings.json and requires enabledPlugins["expo@claude-plugins-official"] === true. I checked it against three inputs: the entry present passes; an empty enabledPlugins fails; `{}` fails. `need node` was added.
- #2 (plausible) and #5 (confirmed): overlay() now always removes the scaffold's .git and runs a fresh `git init`, then fails unless `git rev-parse --show-toplevel` is the app directory. This gives one controlled commit and no writes into a repo the temp dir sits inside.
- #6 (confirmed): when gitleaks is on PATH, the commit step requires `pre-commit PASS secrets`. (PASS|SKIP) is still accepted when gitleaks is absent.
- #1 (plausible): need() now always prints the skip and exits 0 by default. FIXTURE_STRICT=1, set only in the ci.yml fixture job, turns a missing tool into a failure, since a skip there would be a green job that tested nothing. Whether CI is set no longer matters, CI=false included. Tested with an empty PATH: CI=true gives the skip and exit 0; FIXTURE_STRICT=1 gives FAIL and exit 1.
- #4 (plausible): partly fixed, see open_questions and E-036.

Verification: I ran `bash scripts/ci/fixture.sh` end to end locally twice (TMPDIR in the scratchpad), and both runs ended in 'fixture: PASS, every step as expected', exit 0. The overlay step now shows a single commit (de2052d 'fixture: the scaffold with the overlay'). npm installed 460 packages with --ignore-scripts. Doctor reported 17 PASS, 0 FAIL, 0 WARN. The hook commit printed 'pre-commit PASS secrets' with gitleaks 8.30.1. I did not run npm test, because no package code changed.

Two commits used COOKWRIGHT_SKIP=doc-sync, with the reason in the message (no doc-sync rule covers scripts/ci or .github). The hook would have passed them anyway.

I did not stage docs/dev/bundles/stage-3/state.json, which shows as modified by the bundle CLI; it is the orchestrator's to commit. Nothing left the repo.
