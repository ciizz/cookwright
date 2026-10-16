# fix:setup — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `c8e884f chore(config): a doc-sync rule ties the setup skill and the rules block to the README`
- `a3179b8 fix(setup): the loop stops at a line its remedy does not clear`
- `c7e6b0d fix(setup): the walkthrough's end acts on the PASS lines that carry advice`
- `c843f25 docs(readme): First run names --hosts codex and the Codex hook's limits`
- `ec49795 docs(readme): the Windows bullet says what doctor reads for a committed pointer`
- `45f31ff test(setup): the recipe's quoted notes are tied to the messages they match`
- `b607004 chore(backlog): one Closed list, without the blank line after E-028`

## Files
- `cookwright.json`
- `README.md`
- `packages/cookwright/skills/setup/SKILL.md`
- `packages/cookwright/src/lib/skills.test.mjs`
- `docs/dev/backlog.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `skills/setup/SKILL.md loop step 4` | **A remedy that does not clear its line.** When the remedy refuses (it exits non-zero, or prints an `init: …` or `migrate: …` refusal), when the next readout shows the line as it was, or when the developer declines it, show the command's output and the line, and **stop at** that line: never apply the same remedy to the same line twice in a run. One exception: a refusal that names a file to fix by hand (…) makes that fix the next remedy: show the refusal, make the fix it names with consent, then go back to 1. | New loop step (finding 3): ends the endless loop on an init refusal, B-010 or B-002 |
| `skills/setup/SKILL.md loop step 5` | Stop when every line is PASS, or when every line left is one you stopped at: explain each of those in a sentence and take no action on it. Then do what "At the end" says, which covers the PASS lines that carry advice. | Reworded stop step (findings 1 and 3) |
| `skills/setup/SKILL.md host.pointers B-010 row` | FAIL `… missing (run npx cookwright init)`, after init printed `pointer … not written: this filesystem refuses symbolic links (…)` → **stop at**: this filesystem (exFAT, some network mounts) refuses symbolic links, so init cannot write the pointer and the line does not clear; cookwright's backlog tracks it as B-010 | New recipe row (finding 3) |
| `skills/setup/SKILL.md At the end, PASS advice` | Read the last readout's PASS lines once for the two that carry advice, and act on each that is there: a Codex `host.hook` line reading `whether it is trusted is yours: /hooks`, when init wrote or rewrote `.codex/hooks.json` in this walkthrough: say to trust the hook in Codex with `/hooks`, and again after every rewrite of that file; a `gate.scripts` line reading `no gate checks configured`: say pre-push runs nothing, and offer a gate check (`npx tsc --noEmit`, `npx expo lint`, their call), written into `gate.checks` with consent. | Moved from the two PASS rows, which now read 'at the end (see "At the end")' (finding 1) |
| `skills/setup/SKILL.md Windows row` | WARN `… missing: pointers are symbolic links, which cookwright does not support on Windows …`; on Windows also `… is your own; it shadows cookwright's …` for a pointer the repo commits (git checked the link out as a text file) → **stop at**: explain that Windows is not supported in this version; cookwright's backlog tracks it as E-029 | Windows row widened and moved ahead of the your-own row (finding 5) |
| `skills/setup/SKILL.md gate.scripts FAIL row` | `gate check "…" runs npm script "…", which package.json does not define …`, or `…, but there is no package.json at the root …` | Row now quotes the notes so the fragment test can tie them (finding 6) |
| `README.md First run step 2` | init sets the repo up for Claude Code by default; for Codex run `npx cookwright init --hosts codex` instead, or `--hosts claude,codex` for both. | Finding 4 |
| `README.md First run step 3` | In Codex, trust the session-start hook with `/hooks` first (see Codex). | Finding 4 |
| `README.md First run step 4` | In Claude Code, the doctor line appears at session start: `cookwright doctor: level 0 complete`, or the checks that are not PASS. In Codex, whether the hook fires is not measured yet (see Codex), so run `npx cookwright doctor` by hand. | Finding 4, limits the claim until E-027 |
| `README.md First run step 5` | …runs doctor again, and stops at what is yours to decide or at a line its remedy did not clear. | Finding 3 |
| `README.md Windows bullet` | **Windows** is not supported in this version: git checks a symbolic link out as a text file unless `core.symlinks` is on, and doctor then reads a committed pointer as a file of your own (`is your own; it shadows cookwright's …`). Only a pointer init could not write reads as weak naming Windows (backlog item E-029). | Finding 5 |
| `README.md Developing cookwright` | every commit runs the secret scan and two doc-sync rules (the bundle CLI and workflow need `packages/cookwright/docs/playbook.md` or the bundle skill staged; the setup skill and the managed rules block need `README.md` staged) | Finding 2, this repo's new docSync rule |

## Open questions
- Finding 2 asked for two things, and only one is done. The doc-sync rule is added. Folding the README and backlog changes into eccdd28 and 96b977f was not done, because that needs a history rewrite and state.json records those commit ids. The split never left the unmerged bundle branch. Should the branch be rewritten anyway, using the rewrite procedure (main untouched, ids remapped)? I would not.

## Notes
I fixed all six findings marked confirmed or plausible (indexes 1 to 6). I left index 0 alone because it is rejected. The suite passes (469 tests) and doctor reads 17 PASS, level 0 complete.

- **Index 1** (plausible), in c7e6b0d: the two PASS rows' advice (Codex `/hooks` trust, no gate checks) now lives in "At the end", and loop step 5 points there. A new test checks that every PASS row in the recipe is named in that section.
- **Index 2** (plausible), in c8e884f: added a `setup` docSync rule to cookwright.json. A change to the setup SKILL.md or to agents-block.md now needs README.md staged with it. The README's "Developing cookwright" line now says two rules. I did not fold the earlier commits together; that is in open_questions.
- **Index 3** (confirmed), in a3179b8: the loop has a new step 4. It stops at a line whose remedy refused, left the line unchanged, or was declined, and it never applies the same remedy to the same line twice. Exception: an init refusal that names a file to fix by hand makes that fix the next remedy. A new host.pointers row covers init's refused-link line and names B-010.
- **Index 4** (confirmed), in c843f25: README First run step 2 now names `--hosts codex` / `--hosts claude,codex`. Step 3 adds the `/hooks` trust step. Step 4 limits the session-start doctor line to Claude Code and tells Codex users to run doctor by hand until E-027 is measured.
- **Index 5** (confirmed), in ec49795: the README's Windows bullet now says what the code does: a committed pointer reads as "your own", and only a pointer init could not write gets the Windows WARN. The skill's Windows row now matches that "your own" line on Windows and comes before the your-own row. E-029 records that win32 should read such a file as the Windows case. doctor's code is unchanged; that change belongs to E-029.
- **Index 6** (confirmed), in 45f31ff: a fixed list in skills.test.mjs pairs each fragment the recipe quotes with the note that doctor, init, the config loader or bundle messages actually prints. Each fragment must appear in both. The gate.scripts FAIL row now quotes its two notes.
- **Extra, from the review notes**, in b607004: removed the blank line after E-028 that split the Closed list.

Doc-sync skips: c7e6b0d and 45f31ff went through with `COOKWRIGHT_SKIP=doc-sync`, each with the reason in its message.

Message-only amend: I amended a3179b8 to correct the finding number it cites, using `COOKWRIGHT_SKIP=doc-sync,secrets`. That message does not carry the reason. The tree was identical to the commit that had just passed both checks.

Commit messages call each finding by its index in review-setup-1.json ("finding 1" means index 1).

Not done: I did not touch docs/dev/bundles/stage-3/state.json, which the bundle CLI had already modified. Nothing left the repo.
