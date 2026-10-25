# implement:s4 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `070fbfd feat(packs): the expo and supabase ESLint exports`
- `e2bf4aa feat(standards): the standards engine, measured through a fake ESLint`
- `56d99e6 feat(hook): the pre-commit standards check, a per-file ratchet run as a child`
- `63ecb36 test(fixture): a violating component refused by standards, then landed corrected`

## Files
- `packages/cookwright/packs/expo/eslint.cjs`
- `packages/cookwright/packs/supabase/eslint.cjs`
- `packages/cookwright/src/lib/packs/eslint.test.mjs`
- `packages/cookwright/src/test-fixtures/fake-eslint/glob.cjs`
- `packages/cookwright/src/test-fixtures/fake-eslint/index.cjs`
- `packages/cookwright/src/test-fixtures/fake-eslint/package.json`
- `packages/cookwright/package.json`
- `packages/cookwright/src/lib/packs/standards.mjs`
- `packages/cookwright/src/lib/packs/standards.test.mjs`
- `packages/cookwright/src/test-helpers.mjs`
- `packages/cookwright/src/lib/init/packs.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/standards.mjs`
- `packages/cookwright/src/standards.test.mjs`
- `packages/cookwright/src/cli-main.mjs`
- `packages/cookwright/src/cli-main.test.mjs`
- `packages/cookwright/src/lib/hooks/standards.mjs`
- `packages/cookwright/src/lib/hooks/registry.mjs`
- `packages/cookwright/src/hook.mjs`
- `packages/cookwright/src/hook.test.mjs`
- `packages/cookwright/src/lib/messages.test.mjs`
- `scripts/ci/fixture.sh`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.standards.usage` | usage: npx cookwright standards [--staged] | standards command, usage refusal (stderr, exit 2) |
| `messages.standards.notWorkTree` | skipped, not inside a git work tree | standards, exit 11 |
| `messages.standards.noConfig` | skipped, no cookwright.json; run npx cookwright init | standards, exit 11 |
| `messages.standards.configInvalid` | skipped, cookwright.json invalid: ${detail}; run npx cookwright doctor | standards, exit 11 |
| `messages.standards.noRules` | skipped, no ESLint rule of a declared pack is on (packs in cookwright.json) | standards, exit 11 |
| `messages.standards.noEslint` | skipped, needs ESLint (${setup} installs it) | standards, exit 11; setup is the first declared pack's setup line, e.g. npx expo lint |
| `messages.standards.oldEslint` | skipped, needs ESLint 9 or later, for flat config (found ${version || 'no version'}) | standards, exit 11 |
| `messages.standards.configFailed` | skipped, ESLint could not load the repo's config: ${detail} | standards, exit 11 |
| `messages.standards.couldNotRun` | skipped, could not run: ${detail} | standards, exit 11, any unexpected error |
| `messages.standards.skippedBecause` | skipped, ${detail} | standards --staged, exit 11 when a file could not be measured |
| `messages.standards.ruleSkipped` | ${key}: skipped, ${why} | line tail part per unmeasured pack rule (disposition 37) |
| `messages.standards.needs` | needs ${install} | why a rule is unmeasured: its plugin is missing |
| `messages.standards.notWired` | not wired (the ESLint config does not spread ${spec}) | why a rule is unmeasured |
| `messages.standards.overridden` | overridden by a later block in the ESLint config | why a rule is unmeasured |
| `messages.standards.noneMeasured` | skipped, no pack rule is measured: ${parts} | standards, exit 11 |
| `messages.standards.finding` | ${file}:${line}:${column}  ${key}  ${text} | one finding line, printed above the hook's FAIL |
| `messages.standards.parseError` | ESLint could not parse it at ${line}:${column} | why a file is unmeasured |
| `messages.standards.noBlob` | git could not read its content | why a file is unmeasured |
| `messages.standards.notMeasured` | ${n} file(s) not measured: ${first five, …} | line tail part |
| `messages.standards.notMeasuredItem` | ${file} (${why}) | item of notMeasured |
| `messages.standards.deleted` | ${n} deleted file(s) not counted | line tail part |
| `messages.standards.noStaged` | no staged file under a pack's rules | standards --staged, exit 0 |
| `messages.standards.noRise` | ${n} staged file(s), no rise | standards --staged, exit 0 (the hook's PASS note) |
| `messages.standards.rose` | a pack rule's count rose in ${n} staged file(s): ${items} | standards --staged, exit 10 (the hook's FAIL note before the escape) |
| `messages.standards.roseItem` | ${file} ${changes} | item of rose |
| `messages.standards.change` | ${key} ${from} → ${to} | one rule's rise in a file |
| `messages.standards.count` | ${pack}  ${rule}  ${n} | standards (no flag), one line per measured rule |
| `messages.standards.counted` | ${n} file(s) counted at HEAD | standards (no flag), last line |
| `messages.standards.noHead` | skipped, no commit yet to count | standards (no flag), exit 11 |
| `messages.hook.standards.noPacks` | no packs declared | pre-commit standards SKIP, no spawn |
| `messages.hook.standards.failed` | ${line}; fix them, or COOKWRIGHT_SKIP=standards with the reason in the message | pre-commit standards FAIL note |
| `messages.hook.standards.timedOut` | skipped, standards took longer than ${s} s | pre-commit standards SKIP on the 60 s cap |
| `messages.hook.standards.exit` | standards exited ${status ?? 'with no status'}${detail ? ` (${detail})` : ''} | inside 'could not run: …' when the child crashed |
| `messages.hook.standards.silent` | standards printed no line | inside 'could not run: …' |
| `packs/expo/eslint.cjs tokens colour message` | [cookwright expo tokens] use a theme colour token, not a colour literal | ESLint message shown in the editor and by npx eslint; the hook prints the manifest's line instead |
| `packs/expo/eslint.cjs tokens spacing message` | [cookwright expo tokens] use a theme spacing token, not a numeric spacing literal | ESLint message shown in the editor |
| `packs/supabase/eslint.cjs client message` | [cookwright supabase client] import the client from the shared service (services/supabase, lib/supabase or utils/supabase) | ESLint message shown in the editor |
| `scripts/ci/fixture.sh fail texts` | the hook's standards check is not PASS on init's files | the violating commit landed | the violating commit moved HEAD | doc-sync did not pass the component with its doc | standards did not name the colour literal | standards did not name the JSX string | the standards FAIL does not name the file and both rules | a standards line echoed the literal | the corrected commit was refused | standards did not pass the corrected component | the tree is dirty after the corrected commit | fixture FAIL messages (fail()), developer-facing |

## Open questions
- Between now and s5, `npx cookwright standards --ratchet` exits 2 (unknown flag). A fresh config's gate already lists it, so a push from a fresh init's repo fails that gate check until s5 adds --ratchet. The fixture never pushes, so it stays green. Should s5 land before anyone tries a real push, or should s4 accept --ratchet early as exit 11?
- The guides (hooks-and-escapes: the standards check and its 60 s cap; the standards guide), AGENTS.md's Layout and the backlog are left for s6/s7, as the plan schedules. This session's commits change user-facing behaviour without a doc in the same commit. No doc-sync rule of this repo covers the touched paths.
- The no-flag count (`npx cookwright standards`, per rule on HEAD) shipped in s4. No slice names it, and it shares the engine with --staged. It counts HEAD with `git ls-tree`, not the index with `git ls-files -s` as §4.5 says, to match the plan's 'on HEAD'. Is that reading right?
- Plan §4.5 reads blobs with `git show <ref>:<path>`. The engine reads both sides' blob shas from `git diff --raw` / `ls-tree` and calls `git cat-file --batch` once per 500 blobs. The result is the same, with fewer processes and no path quoting. Flagging it as a departure from the letter of the plan.
- This checkout's core.hooksPath is `.husky/_`, not `.githooks`, so this repo's own commits in this session may not have gone through cookwright's hooks. Is that intended (dogfood is s7)?

## Notes
The four s4 checkpoints are committed, each staging named paths only. `npm test`: 24 files, 637 tests passed. `bash scripts/ci/fixture.sh` passed locally (Node 20.19.4, gitleaks on PATH, real ESLint 9.39.5). Init's commit reads `pre-commit  PASS  standards  1 staged file(s), no rise`. A component with `'#ff0000'` and JSX text is refused, naming `expo tokens` and `expo strings` at 4:32 and 4:45, with HEAD unmoved and the literal never echoed. The corrected component then lands with standards PASS.

Measured:
- `standards --staged` on the fixture tree takes 1.24 s wall; the no-flag count over HEAD's 3 lintable files takes 1.84 s.
- The strings exclude list (disposition 44) was measured with a throwaway script in the scratchpad. It ran the origin repo's own ESLint 9.39.4 and i18next 6.1.4 read-only over its src/ and app/ .tsx files, with no config file and no cache. With the plugin's default attribute excludes, jsx-only mode reported 1404 attribute strings in 183 files and 0 JSX text strings. With the shipped list, 50 remain in 31 files, all app-specific props (scroller 22, value 6, and others). Labels, hints, placeholders, titles and `value` stay measured.
- The plugin's `_.defaults` merge is shallow, so the list repeats the plugin's own defaults first.
- The real ESLint's `calculateConfigForFile` reports severity as the number 2. A config that fails to load rejects both `calculateConfigForFile` and `lintText`; the engine reads that as exit 11 "ESLint could not load the repo's config".

Design points:
- The hook check spawns this package's own bin from the config root with git's environment, a 60 s timeout and SIGKILL. Exits map 0 PASS, 10 FAIL, 11 SKIP, anything else could not run. The child's stderr (for example eslint-plugin-react's 'React version' warning) is shown only when it crashes.
- `io.spawn` is threaded through hook.mjs as `ctx.spawn`.
- `installed()` in init/packs.mjs is now exported for the engine's plugin check.
- The expo export carries a non-enumerable `withResolver` seam, so a spread never sees it.
- `src/test-fixtures/**` is excluded from the tarball; `npm pack --dry-run` lists both eslint.cjs files and no test fixture.
- Nothing left the repo; no publish or push was run.
