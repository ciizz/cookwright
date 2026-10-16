# fix:whole — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `606321b fix(doctor): expect every skill the manifest lists, so a damaged install never reads host.pointers PASS`
- `d694586 fix(codex): read a doctor hook copy under another matcher beside the right one as WARN, and have init remove it`
- `0b36723 fix(init): replace a pointer atomically and report any failure to write it, never a stack`
- `fb15aea fix(bundle): name the rules files of the host the bundle runs in, not the first configured host's`
- `f164823 fix(codex): read the Codex hook as WARN for a config root below the work tree's top`
- `de4c710 docs(readme): run init before /setup on the first update, since init writes the skill's pointer`
- `94242a8 docs(readme): say a personal skill named setup may shadow cookwright's unreported; backlog E-037`

## Files
- `packages/cookwright/src/lib/doctor/hosts.mjs`
- `packages/cookwright/src/lib/hosts.mjs`
- `packages/cookwright/src/lib/doctor/codex.mjs`
- `packages/cookwright/src/lib/init/hostfile.mjs`
- `packages/cookwright/src/lib/init/files.mjs`
- `packages/cookwright/src/init.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/skills/setup/SKILL.md`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/src/bundle.test.mjs`
- `packages/cookwright/src/lib/config.test.mjs`
- `packages/cookwright/src/lib/skills.test.mjs`
- `README.md`
- `docs/dev/backlog.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.doctor.codex.hook.stray` | ${file} also has the doctor hook under ${found === undefined ? 'no matcher' : `matcher ${found}`}, beside ${want} (run npx cookwright init) | doctor host.hook (Codex) WARN when a copy of the doctor hook sits under another matcher beside startup|resume |
| `messages.doctor.codex.hook.nested` | ${file} carries the doctor hook, but the hook runs doctor from the work tree's top, which finds no cookwright.json for this config root (${rel}), so it gives no readout; run npx cookwright doctor here by hand | doctor host.hook (Codex) WARN when the config root is below the work tree's top |
| `messages.init.hostHook.stray` | the doctor hook's copies under matchers other than ${matcher} removed; the other hooks kept | init row note when it removes a stray-matcher copy of the Codex hook |
| `messages.init.pointers.writeFailed` | pointer ${rel} not written (${code}); whatever stood there is unchanged | init line after the rows when a pointer write fails for a reason other than the filesystem refusing links (EACCES, a failed rename or mkdir) |

## Open questions
- Finding #5, the plan half. Section 8's QA leg (plan.md line 171) still says to open Claude Code on the personal app and run /setup straight away. On that repo the setup pointer is the very pointer doctor reports missing, so /setup cannot be found. I did not edit the plan: only the orchestrator has ever edited it, and its sha is in the state. Before the QA phase, please record the deviation with `bundle decide`: run `npx cookwright init` by hand first (or let the agent run it from the host.pointers FAIL line), then run /setup in a new session to drive the rest to complete. The README now says the same thing.

## Notes
I fixed all eight confirmed and plausible findings and left #1 (rejected) alone. I ran `npm test` after the last commit: 17 files, 478 tests passed (475 before the new tests). `npx cookwright doctor` on this repo still reads 17 PASS, level 0 complete. Every commit went through the hooks, and none needed a doc-sync skip.

- **#0 (plausible), commit 606321b.** `shippedPieces` now takes the expected skills from the `SKILLS` list in `hosts.mjs`, not from the folders the installed package happens to hold. A skill pointer only counts as resolving when its target has a `SKILL.md`. So an install missing `skills/setup/SKILL.md` now gives a `host.pointers` WARN ("not installed where it points (npm install)") instead of PASS. Added a doctor test, and the init test now proves `setup` is still expected when its file is absent. Workflows are still read from disk; the finding was about skills only.
- **#2 (confirmed), commit d694586.** Doctor's Codex `host.hook` now gives a new WARN (`stray`) when the doctor hook also sits under another matcher beside `startup|resume`. Init now removes those extra copies even when the correct one is there, and reports it with a new note (`hostHook.stray`). Init and doctor tests cover the mixed case, and the setup recipe, its quote test and the README's Codex paragraph name the new line.
- **#3 (plausible) and #4 (confirmed), commit 0b36723.** Init now makes the new pointer next to the old one and renames it into place, so a failed update leaves the old pointer intact. The folder creation, the link and the rename are all inside the error handler, and a temporary link left by a failed rename is removed. "This filesystem refuses symbolic links" is printed only when the link itself was refused and the code is not EACCES. Any other failure prints a new line, `pointer <rel> not written (<code>); whatever stood there is unchanged`. Tests cover a failure at the link and at the rename (old pointer kept, nothing left beside it), plus folder and link permission failures. The permission test is skipped when running as root. The setup recipe and README name the new line. Ordinary file writes (`writeFile`) still fail with a raw error, as the finding's evidence noted; I left that alone.
- **#5 (confirmed), commit de4c710.** The README's Updating step now says: on a repo set up before the skill existed, run `npx cookwright init` first, then /setup ($setup in Codex), in a new session if the host does not list it yet. I left the SKILL.md description unchanged, because only a session that can already see the skill reads it. The plan's QA leg is in open_questions.
- **#6 (confirmed), commit fb15aea.** The bundle's rules files (`rulesFiles`) now come from the same host the bundle runs in (the first configured host with workflows), falling back to the first host. With hosts [codex, claude], CLAUDE.md is now included. The config test expectation changed, and a bundle test checks that `args.rules` holds CLAUDE.md for that host order.
- **#7 (confirmed), commit f164823.** Doctor's Codex `host.hook` is now WARN (`nested`) instead of PASS when `cookwright.json` sits below the work tree's top, and says to run doctor by hand. The setup recipe stops at that line and names B-002. The README's Codex paragraph and the B-002 backlog line describe the limit. A test covers it.
- **#8 (plausible), commit 94242a8.** The README bullet now says a personal `~/.claude/skills/setup` may also win, as Claude Code's docs say, and that doctor does not check for it. Logged E-037 for a doctor WARN once the precedence is measured. I did not build that check now because the precedence is not measured.

New or changed setup recipe rows (SKILL.md), each tied to its message by `skills.test.mjs`: the Codex stray-matcher WARN, the Codex nested-root WARN, and the init "not written (…)" stop.
