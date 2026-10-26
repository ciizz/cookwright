QA round 1, 2026-10-26, the orchestrator: plan §7, the user's own lint run on a fresh Expo scaffold, and the fixture on the branch.

Measured on the scratch Expo tree from stage 4's docs refresh (a `create-expo-app` blank TypeScript scaffold, Expo SDK 58, Node 22, `eslint` 9.39.5, `eslint-config-expo` 58.0.4, `eslint-plugin-i18next` 6.1.5, Expo's `eslint.config.js` with the two pack lines init spread, the pointers under `.claude/`), the package installed from this branch's tarball (`npm pack` at fe545b0b, still named 0.2.0):
- The export's first block: `{ "name": "cookwright/expo/ignores", "ignores": [".claude/workflows/**"] }`.
- `npx expo lint`: one problem, `App.tsx 7:13 error i18next/no-literal-string` (the scaffold's own literal string), exit 1; with the 0.2.0 export the same run reported the two workflow pointers as parsing errors as well (stage 4's QA (b) refresh, the same tree).
- `npx eslint . --format json`: 3 files linted, 1 with errors (`App.tsx`, `i18next/no-literal-string`), 0 files under `.claude/`.
- `npx cookwright doctor`: 28 checks, 27 PASS, 1 WARN (`pack.supabase.types`, no `db:types` script), both lint rows PASS, unchanged from before the fix.
- `npx cookwright standards`: `expo strings 1, expo tokens 0, expo size 0, supabase client 0`, 2 files counted at HEAD, unchanged.
- `bash scripts/ci/fixture.sh` at fe545b0b (after fix:fix, which changed the lint-run step without rerunning it): `fixture: PASS, every step as expected`, the `npx eslint . --format json` step among them. The install step printed npm's deprecation notice for `eslint@9.39.5` ("no longer supported"); the pin is bumped by hand (E-036) and is not this bundle's.
- The negative control is the implement session's: with the ignores block removed from the installed copy in a kept fixture tree, the step failed with `the user's own lint run reported a harness file: .claude/workflows/bundle-phase.js`; restored, it passed.

Findings: none. Every line read as plan §7 expected.
