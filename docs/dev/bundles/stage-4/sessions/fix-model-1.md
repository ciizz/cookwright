# fix:model — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `0646955 fix(init): probe and ignore a symlinked node_modules without the slash (B-011)`
- `83aa93d fix(init): refuse two writes to one path before any write lands`
- `844a68a fix(packs): the expo design-doc rule leaves __tests__ and __snapshots__ out`
- `c66d438 fix(doctor): pack.<name>.docs WARNs a pack doc-sync rule that is not the pack's`
- `27a65ad fix(doctor): count React Native platform files as one primitive`
- `79c187c fix(doctor): an unreadable code directory reads not counted, never a measured 0`
- `812235e fix(schema): each pack at most once, as a name or an object`
- `cb9cb0b fix(init): recognise a pack export imported or double-quoted, and advise import lines for an ES module config`
- `2b5eff8 fix(init): the ES module import line lives in messages.mjs`

## Files
- `packages/cookwright/src/lib/init/gitignore.mjs`
- `packages/cookwright/src/lib/init/files.mjs`
- `packages/cookwright/src/lib/init/steps.mjs`
- `packages/cookwright/src/lib/init/packs.mjs`
- `packages/cookwright/src/lib/config.mjs`
- `packages/cookwright/src/lib/config.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/doctor/packs.mjs`
- `packages/cookwright/src/lib/packs/entries.mjs`
- `packages/cookwright/src/lib/packs/entries.test.mjs`
- `packages/cookwright/src/lib/packs/registry.test.mjs`
- `packages/cookwright/src/lib/hooks/docsync.test.mjs`
- `packages/cookwright/packs/expo/pack.mjs`
- `packages/cookwright/packs/expo/templates/design-system.md`
- `packages/cookwright/schema/cookwright.schema.json`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `docs/guides/getting-started.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.init.collision` | ${rel} would be written twice, for ${a} and for ${b}; give one of them another path in cookwright.json, then rerun | init refusal in preflight when two steps write one path, or one writes under another's file (finding 0) |
| `config.mjs validatePackDocs (inline, as the other config problems)` | paths.${key} and the ${name} pack's contract doc overlap (${paths[key]}, ${doc.path}) | config loader problem when a paths.* home nests or coincides with a declared pack's contract doc (finding 0) |
| `messages.doctor.pack.docs.ruleDiffers (replaces ruleOther)` | the doc-sync rule ${rule} is not the pack's, so a change to the code may go without ${doc} (the setup skill offers the pack's rule; a rule of your own goes under another name) | pack.<name>.docs WARN when the pack-owned doc-sync rule's code or docs differ from the manifest's (finding 1) |
| `messages.doctor.pack.docs.unreadable` | ${plural noun} not counted: ${dir} could not be read (${code}) | pack.<name>.docs SKIP (WARN beside another problem) when a code directory cannot be read, e.g. 'primitives not counted: src/components could not be read (EACCES)' (finding 2) |
| `messages.init.pack.eslint.otherModule` | not Expo's template, left alone; add ${list(imports)} at its top and ${list(spreads)} to its config array by hand (the setup skill does it with consent) | init eslint.config row for an ES module config (.mjs, .mts, .ts, or .js under type module) that does not name a pack's export (finding 6) |
| `messages.init.pack.eslint.importLine` | import ${binding} from '${spec}'; | the import line named for an ES module ESLint config, e.g. import cookwrightExpo from 'cookwright/packs/expo/eslint.cjs'; (finding 6) |
| `packs/expo/templates/design-system.md (header sentence)` | Keep the first column exactly the component's name: its file name without the extension (and without a platform suffix: `Map` for `Map.web.tsx` and `Map.native.tsx`), or its directory's name for a `<Name>/index.tsx` (or `index.ios.tsx`, `index.android.tsx`). | expo contract-doc template, written once by init (finding 5) |
| `docs/guides/getting-started.md (doctor paragraph)` | its doc-sync rule is configured as the pack ships it, a rule of your own going under another name | guide wording for pack.<name>.docs after finding 1 |

## Open questions
- Finding 1 (plausible) was fixed by requiring the doc-sync rule under the pack's name (expo:design-doc, supabase:data-doc) to match the manifest's code and docs exactly, in any order, or the row WARNs. A user who wants a wider or retargeted rule keeps the pack's rule and adds their own under another name. If you would rather allow supersets (extra positive code pathspecs, say), that is a product call, and ruleProblem in src/lib/doctor/packs.mjs is the one place to loosen.

## Notes
I fixed 8 of the 9 findings and declined 1. `npm test` passes (21 files, 589 tests) and `bash scripts/ci/fixture.sh` ends in "fixture: PASS, every step as expected". I staged named paths only and never touched state.json.

- **Finding 4 (P2, B-011, symlinked node_modules), 0646955.** When node_modules is a symbolic link, init now asks git about `node_modules` without the slash and appends that line. A test in init.test.mjs covers a fresh repo and one whose .gitignore holds only `node_modules/`.
- **Finding 0 (P2, two steps writing one path), 83aa93d.** Two parts:
  - The config loader now refuses any `paths.*` value that coincides with or nests a declared pack's contract doc.
  - preflight now runs `refuseCollisions`, which refuses two writes to one path, or a write under another write's file, before anything is written. That also covers collisions the config check cannot see, such as `paths.backlog` set to AGENTS.md or `paths.closeouts` set to AGENTS.md. Both parts have tests.
- **Finding 7 (P3, `__tests__` and snapshots), 844a68a.** The expo design-doc code pathspecs now also exclude `:!**/__tests__/**` and `:!**/__snapshots__/**`. The two test copies of the default are updated, and a docsync test using the real manifest rule shows tests and snapshots pass while a component change still asks for the doc.
- **Finding 1 (P2 plausible, doc-sync rule check), c66d438.** The pack-owned rule must now match the manifest's code and docs exactly. The open question explains how to loosen this. The getting-started guide is updated in the same commit.
- **Finding 5 (P3, platform files), 27a65ad.** The lister drops a `.ios`, `.android`, `.native` or `.web` suffix, and accepts `index.<platform>.(tsx|jsx)` as a directory's index. The design-system template says so; it is written only when absent, and its section version is unaffected.
- **Finding 2 (P3, unreadable directory), 79c187c.** `dirents` returns nothing only for ENOENT or ENOTDIR and rethrows anything else. `pack.<name>.docs` then reads SKIP, naming the directory root-relative and the error code, or WARN when it sits beside a problem that was measured. I chose SKIP over letting the error reach the runner's generic FAIL, because disposition 11 says this row never FAILs. Both tests skip when run as root.
- **Finding 3 (P3, schema), 812235e.** The packs schema gains one `allOf` entry per pack, each `contains` (the name or `{name}`) with `minContains` 0 and `maxContains` 1, and config.test checks it stays in step with `KNOWN_PACKS`. I could not run a draft 2020-12 validator: the only local ajv copies are 6.x.
- **Finding 6 (P3, ESLint config detection and advice), cb9cb0b and 2b5eff8.** Init now counts the export path in single, double or backtick quotes as wired, whether by require or import. For an ES module config (`.mjs`, `.mts`, `.ts`, or `.js` under `"type": "module"`), the skipped row now gives import and spread lines (`import cookwrightExpo from 'cookwright/packs/expo/eslint.cjs';` and `...cookwrightExpo,`). 2b5eff8 moves the import-line template into messages.mjs because messages.test refused it as prose. That commit used `COOKWRIGHT_SKIP=doc-sync` with the reason in its message, though no doc-sync rule covers those files.
- **Finding 8 (P3 plausible), declined.** It describes the planned interim state at 1355fc7, not a defect, and its own suggested fix is no code change. s4 and s5 are what land `eslint.cjs`, the `standards` command and gate `skipExit`. Until they do, `bundle/stage-4` must not be merged, packed for users or released. The plan already has the fixture prove a refused and a passing commit from s4 on, which would catch a missing `eslint.cjs`.
