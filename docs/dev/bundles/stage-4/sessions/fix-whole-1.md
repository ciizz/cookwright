# fix:whole — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `5639dee fix(hooks): doc-sync passes over a pack-owned rule switched off in packs and names it`
- `9bb9e8b fix(doctor): pack rows check the gate's standards entries, their command and skip exit`
- `268063e fix(packs): an ESLint rule's sentence says it is measured against the ratchet's base, not the base branch`
- `9b47fdc fix(standards): a file the repo's ESLint config ignores is outside the pack's rules, named, never a skip`
- `71b1ef6 chore(config): a doc-sync rule ties the standards command, hook check, doctor pack rows and pack init to the standards guide`

## Files
- `packages/cookwright/src/lib/hooks/docsync.mjs`
- `packages/cookwright/src/hook.test.mjs`
- `packages/cookwright/src/lib/doctor/packs.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/lib/skills.test.mjs`
- `packages/cookwright/skills/setup/SKILL.md`
- `packages/cookwright/src/lib/packs/section.mjs`
- `packages/cookwright/src/lib/packs/section.test.mjs`
- `packages/cookwright/src/lib/packs/standards.mjs`
- `packages/cookwright/src/lib/packs/standards.test.mjs`
- `packages/cookwright/src/standards.mjs`
- `packages/cookwright/src/standards.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `docs/guides/standards.md`
- `docs/guides/hooks-and-escapes.md`
- `docs/guides/getting-started.md`
- `cookwright.json`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.hook.docSync.off` | ${names} not checked, switched off in packs | doc-sync pre-commit line tail when a pack-owned doc-sync rule's pack rule is switched off |
| `messages.hook.docSync.allOff` | no doc-sync rule checked: ${names} switched off in packs (cookwright.json) | doc-sync SKIP when every configured rule is a switched-off pack rule |
| `messages.doctor.pack.lint.noGate` | the gate runs no standards ratchet; add ${entry} to gate.checks (npx cookwright packs rules prints it) | pack.<name>.lint WARN part when gate.checks has no standards --ratchet entry |
| `messages.doctor.pack.noSkipExit` | the gate check ${name} has no "skipExit": ${exit}, so its "cannot measure" exit fails the gate; add it | pack.<name>.lint and pack.supabase.types WARN when the gate entry lacks skipExit 11 |
| `messages.standards.ignoredFiles` | ${n} file(s) the ESLint config ignores not counted: ${files} | informational tail part of standards --staged/--ratchet/count lines; replaces messages.standards.fileIgnored (removed) |
| `AGENTS.md pack section ESLint measurement (packs/section.mjs)` | measured by ESLint ${ids} on the staged files at commit and against the ratchet's base at the gate | was 'against the base branch at the gate'; generated into a user's AGENTS.md |

## Open questions
- Finding 3, types half: when the supabase `types` rule is switched off, a leftover `standards:types` gate entry still exits 11, and the gate records it as skipped (a WARN when the bundle lands). I kept that behaviour, because by rule 2 a state the user chose is WARN with the reason. The guide now says so. If you would rather the gate entry pass quietly while its rule is off, that is a product call.
- Finding 3, undeclared pack: the doc-sync hook now skips a pack-owned rule only when its pack is declared and that rule is switched off. A pack removed from `packs` keeps its `expo:design-doc` entry enforced as written, and that residue sits with E-040 (the section that lingers after a pack is removed). Should it be dropped too?

## Notes
All 6 confirmed findings in review-whole-1.json are fixed in 5 commits. npm test: 740 passed, 26 files. `bash scripts/ci/fixture.sh`: PASS. This repo's own doctor: 19 PASS, level 0 complete.

- Finding 0 (P2, types row accepted any command and ignored skipExit) and findings 1 and 5b (P2/P3, no doctor row checked the ratchet entry) are fixed in 9bb9e8b. A new `gateProblem` helper in `src/lib/doctor/packs.mjs` only accepts an entry whose run is exactly `cookwright standards --<mode>`, called through npx, node or the bin's path, with at most `--base <ref>` after it. The entry must also have `skipExit === 11`. `pack.supabase.types` and `pack.<name>.lint` both use it and now WARN when the entry is missing (the WARN names the entry to add) or lacks `skipExit` (the WARN says so). I put the ratchet check in the existing `.lint` row rather than adding a new row, so readout counts and the setup recipe inventory stay the same. Tests cover a missing skipExit, an `echo` false positive, `&& true` and `--staged` trailing args, plus the `--base` and node-path forms that are accepted. Setup skill rows, skills.test QUOTED and the guides are updated.
- Finding 3 (P2, doc-sync enforced switched-off pack rules) is fixed in 5639dee. `checkDocSync` now skips a pack-owned rule whose pack is declared with that rule switched off, and names it on the line. It reads SKIP when no other rule is left. A hook test was added, and the standards and hooks-and-escapes guides are corrected. The types-gate half and the undeclared-pack case are in open_questions.
- Finding 4 (P3, one ESLint-ignored file turned the verdict into exit 11) is fixed in 9b47fdc. `scopeAt` returns `{ rules: [], ignored: true }` for such a file. The staged, ratchet and count modes count nothing for it and name it in an informational tail part that `skippedParts` does not read as skipped. Exit 11 stays for real failures: a covering rule changed by a later block, or a config that cannot be computed. `messages.standards.fileIgnored` is removed. Tests are updated, including a check that `skippedParts` returns [] for the new line.
- Finding 5a (P3, sentence said 'against the base branch') is fixed in 268063e: the sentence now reads 'against the ratchet's base at the gate'. I did not bump the pack manifest versions, which stay at 1: no pack section has shipped in a release (npm 0.1.0 had no packs), and stale detection compares the rendered text anyway.
- Finding 2 (P3, doc-sync coverage gap) is fixed in 71b1ef6 by a new `standards` doc-sync rule in `cookwright.json`. It ties `src/standards.mjs`, `src/lib/hooks/standards.mjs`, `src/lib/doctor/packs.mjs` and `src/lib/init/packs.mjs` to `docs/guides/standards.md`. That commit used COOKWRIGHT_SKIP=doc-sync with the reason in the message. In hindsight the skip was not needed: no rule covers `cookwright.json`, so doc-sync would have passed anyway.

The bundle state file `docs/dev/bundles/stage-4/state.json` was left untouched and unstaged. Nothing was run that leaves the repo.
