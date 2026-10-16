# implement:s1 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `f0a7aab feat: ship the host adapters, the skills and the playbook in the package`
- `a2d7ccf feat: paths.playbook optional, the package's playbook by default; codex a known host`
- `d4d7598 test: bundle args and status through the node_modules link, hoisted case included`
- `ed37040 test: the two bundle refusals, playbook missing and no host with workflows`

## Files
- `packages/cookwright/hosts/claude/workflows/bundle-phase.js`
- `packages/cookwright/hosts/claude/workflows/docs-audit.js`
- `packages/cookwright/skills/bundle/SKILL.md`
- `packages/cookwright/docs/playbook.md`
- `.claude/skills/bundle`
- `.claude/workflows/bundle-phase.js`
- `.claude/workflows/docs-audit.js`
- `cookwright.json`
- `AGENTS.md`
- `README.md`
- `packages/cookwright/package.json`
- `packages/cookwright/schema/cookwright.schema.json`
- `packages/cookwright/src/lib/hosts.mjs`
- `packages/cookwright/src/lib/config.mjs`
- `packages/cookwright/src/lib/config.test.mjs`
- `packages/cookwright/src/lib/bundle/phases.mjs`
- `packages/cookwright/src/lib/bundle/messages.mjs`
- `packages/cookwright/src/bundle.mjs`
- `packages/cookwright/src/bundle.test.mjs`
- `packages/cookwright/src/test-helpers.mjs`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/src/doctor.test.mjs`

## User-facing strings
| key | text | context |
|---|---|---|
| `bundle.messages.noPlaybook (not installed)` | the playbook is not at <path> (cookwright is not installed under the config root or the work tree top: npm install --save-dev cookwright) | bundle args / bundle status refusal, exit 2, prefixed 'bundle <command>: '; <path> is config-root relative, e.g. node_modules/cookwright/docs/playbook.md |
| `bundle.messages.noPlaybook (configured)` | the playbook is not at <path> (paths.playbook names it) | bundle args / bundle status refusal, exit 2, when paths.playbook names a missing file |
| `bundle.messages.noWorkflowHost` | the bundle runner needs a host with workflows (claude); hosts is [codex] | bundle args / bundle status refusal, exit 2, when no configured host has workflows; both lists derived from the host table and the config |
| `bundle.messages.pointerMissing` | run init: the workflow pointer <path> is missing | extra status line, printed as 'note     : …' under the next line, when the workflow pointer (at the work tree top, shown config-root relative) is absent |
| `bundle.messages.next.launch` | Workflow({ name: 'bundle-phase', args: <output of `npx cookwright bundle args <slug> <phase>`> }), then `phase <slug> run <phase> --run-id <id>` | status next line; was the scriptPath form |
| `bundle.messages.next.resume` | Workflow({ name: 'bundle-phase', resumeFromRunId: '<id>', args: <output of `npx cookwright bundle args <slug> <phase>`> }) | status next line for a run in flight; was the scriptPath form |
| `schema.paths.playbook.description` | Your own bundle playbook. Absent, every session reads the package's copy, which updates with it. Root-relative, no trailing slash. | JSON Schema description shown in editors; the default was removed |
| `schema.hosts.description` | Agent hosts this repo is set up for, each once. The first is the default host, whose rules files the CLI names; the bundle runner uses the first host that has workflows (claude). | JSON Schema description shown in editors; enum gains codex |

## Open questions
- Codex is a known host since s1 (it had to be, for the schema enum and the codex-only refusal), but its HOSTS entry has only rules, shadowing [], importLine null and workflowsDir null. init's hostStep and doctor's hostCheck look up HOST_STEPS/HOST_CHECKS by hosts[0], so a config with codex first breaks there until s4 lands: doctor reports host.rules and host.hook as 'the check could not run' FAILs, and init most likely throws. s4 should also set shadowing to ['AGENTS.override.md'], which I left out so rules.size would not change without tests.
- HOSTS.claude gained workflowsDir '.claude/workflows' in s1, because status needs it for the pointer check. s3 still adds skillsDir. PACKAGE_ROOT (plan §4.1) was not added because nothing in s1 uses it; s3 adds it with the pointers.
- Plan §10's checkpoint names 'bundle args stage-3 implement:s2 measured on this repo'. That command refuses ('start implement:s2 first') until the orchestrator starts that phase, so I measured implement:s1 instead (see notes).
- AGENTS.md Layout: besides rewriting line 12, I added one line saying .claude/ holds this repo's pointers into node_modules/cookwright. s6 owns the final Layout text (§7.5) and may reword it.
- status prints the missing-pointer line as a separate 'note     : …' line under 'next'. That label is new to the status readout.

## Notes
s1 is done in four commits: the moves, then config and schema parity, then bundle args through the link, then the refusals. Baseline was 14 files and 317 tests; it is now 14 files and 326 tests, all green. The pre-commit hook passed every commit (secrets and doc-sync); no skip was used.

1. f0a7aab (the moves): moved with git mv.
   - hosts/ is now packages/cookwright/hosts/, docs/playbook.md is now packages/cookwright/docs/playbook.md, and the bundle skill is now packages/cookwright/skills/bundle/.
   - The three .claude links were rewritten straight into their final form under ../../node_modules/cookwright/..., and they resolve through the workspace link.
   - The doc-sync rule paths moved, and this repo's paths.playbook was dropped (disposition 13).
   - package.json files gains hosts, skills and docs.
   - The broken doc lines were fixed: README.md:24 and :57, AGENTS.md:12, the playbook's line 6, SKILL.md:8, bundle.mjs:8-9 and hosts.mjs:9.
   - Measured with npm pack --dry-run: it lists docs/playbook.md, hosts/claude/workflows/bundle-phase.js, hosts/claude/workflows/docs-audit.js and skills/bundle/SKILL.md; 61 files, 96.7 kB.

2. a2d7ccf (config and schema):
   - DEFAULTS.paths no longer has playbook, and OPTIONAL_PATHS was added. The validator checks paths.playbook only when present (root-relative rule and overlap check), and freshConfig stops writing it because it spreads DEFAULTS.paths.
   - The schema drops the playbook default, rewords two descriptions and adds codex to the hosts enum. Schema version stays const 1 for s2.
   - hosts.mjs gains PACKAGE_DIR, installedPackage(repo) (the config root's install first, else the work tree top's, as a config-root-relative path), playbookPath(config, repo) and upToTop. workflowScript now returns the pointer of the first configured host with workflows, or null. The skills key is gone.
   - The bundle code had to change in this commit or the suite would go red: phases.workflowPaths runs the host and playbook refusals before any hash, status prints the named Workflow form, and openRepo now carries top. Playbook step 2 was updated to match.
   - The unknown-host tests in init.test.mjs and doctor.test.mjs used 'codex' as the unknown host; they now use 'gemini'.
   - linkPackage(dir) was added to test-helpers.

3. d4d7598 (bundle args through the link):
   - Tests cover the root install, the hoisted-to-the-top case from apps/mobile (status prints the note with ../../.claude/workflows/bundle-phase.js until the pointer exists) and the root install winning over the top's.
   - Measured on this repo: `npx cookwright bundle args stage-3 implement:s1` gives playbook node_modules/cookwright/docs/playbook.md (sha 6c4ae496f43cc3f1). `bundle status stage-3` prints `Workflow({ name: 'bundle-phase', resumeFromRunId: 'wf_8211b6d1-775', args: … })` with no note.

4. ed37040 (the refusals):
   - Tests cover args and status refusing with exit 2 and printing nothing else when the package is missing, the refusal that names paths.playbook, `hosts: [codex]` refused, and `[codex, claude]` running on claude's pointer.

Nothing left the repo. I never staged docs/dev/bundles/stage-3/state.json; it stays dirty as the bundle CLI wrote it.
