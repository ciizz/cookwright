# fix:surface — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `b95c851 fix: secrets.carriers reads .envrc from the work tree's top for a nested config`
- `ef6c1c3 fix: the secrets pass closes with a key left unproved`
- `c385998 fix: the setup skill is matched by a secrets request`
- `f933c10 fix: the secrets pass says the supabase proof needs the supabase pack`
- `875c97e docs: the secrets guide's model says a stale export stays in the shell`
- `6a1ec13 docs: AGENTS.md's Layout names every secrets module`
- `f92ea5e fix: the managed block forbids reading a secret from the backend directly`

## Files
- `packages/cookwright/src/lib/doctor/secrets.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/lib/skills.test.mjs`
- `packages/cookwright/skills/setup/SKILL.md`
- `packages/cookwright/src/lib/rules/agents-block.md`
- `packages/cookwright/src/lib/rules/block.test.mjs`
- `docs/guides/secrets.md`
- `docs/dev/backlog.md`
- `AGENTS.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.doctor.secretsCarriers.envrcAbove` | .envrc above the config root: ${list(files)} (direnv exports it into every command below it; run injects into one) | doctor secrets.carriers WARN part for an untracked .envrc at the work tree's top or in a directory between it and a nested config root (new) |
| `skills/setup/SKILL.md description` | ... or when the developer asks to set cookwright up, or to set up secrets (a backend, a target, the first run). | setup skill frontmatter description, which the host matches requests against (changed) |
| `skills/setup/SKILL.md intro, secrets request` | A request to set up secrets (a backend, a target, the first run) goes straight to **the secrets pass** under "At the end" once no Level 0 row FAILs: run doctor, take such a FAIL by its recipe first, then walk the pass; the rest of the walkthrough waits until the developer asks for it. | setup skill, paragraph before ## Rules (new) |
| `skills/setup/SKILL.md secrets pass step 5` | Exit 0 with every name a proof kind can cover proved closes the pass. A name no kind covers (a key: a Supabase `service_role` or `anon` key, an API token) stays `unproved` on the banner, and that is the expected state: name it to the developer, and never try to prove it (never add it to the proof's `names`, never drop it from the target). Exit 125 is a refusal whose one line names the fix. | setup skill secrets pass, step 5's close condition (changed) |
| `skills/setup/SKILL.md secrets pass step 3` | the `supabase` kind exists only with `supabase` in `packs` (otherwise the config is refused, `config` FAILs and no command runs), so with no supabase pack declared offer the pack first, as the `packs` recipe above adds it, or write a `host` proof for the project's host instead | setup skill secrets pass, step 3 (added) |
| `skills/setup/SKILL.md carriers recipe row` | | WARN | `tracked .envrc: …`, `.envrc above the config root: …`, `.envrc at the root …` | ... | setup skill secrets.carriers recipe table (changed) |
| `rules/agents-block.md Secrets bullet` | Never read a value from the backend yourself (`age -d`, `op read`, `op inject`, `security find-generic-password -w`) and never open the identity file; a refusal's own line names the fix. | managed AGENTS.md block v4, Secrets section, rendered into every user's AGENTS.md (new) |
| `docs/guides/secrets.md model bullet` | The values are never added to your shell's environment or to cookwright's own: they stay in cookwright's memory until the command starts. A stale export of a declared name is not removed from your shell or from cookwright's own environment, only from the command's (next point). | secrets guide, The model, second bullet (changed) |
| `docs/guides/secrets.md setup step 5` | exit 0 with every name a proof kind can cover proved means the target works. A name no kind covers (a key, such as Supabase's `service_role` key) stays unproved on the banner, and that is expected: keep it in the target, and don't add it to the proof's `names`, which would refuse every run. | secrets guide, Setting up, in order, step 5 (changed) |
| `docs/guides/secrets.md setup skill sentence` | ...running doctor after each; a FAIL among doctor's Level 0 rows is cleared first, and the rest of its walkthrough waits until you ask for it. | secrets guide, after Setting up, in order (changed) |
| `docs/guides/secrets.md carriers bullet` | An `.envrc` at the work tree's top or in any directory down to the config root, tracked or not, or tracked anywhere under the config root: direnv exports it into every command below it. The row names each from the top, so a nested config's parent `.envrc` counts. | secrets guide, secrets.carriers row description (changed) |
| `docs/guides/secrets.md agent rules list` | never read a value from the backend itself (`age -d`, `op read`, `op inject`, `security find-generic-password -w`) and never open the identity file: a refusal's own line names the fix; | secrets guide, What the agent is told (new item) |

## Open questions
- none

## Notes
I fixed the 8 findings marked for fixing (0, 1, 2, 4, 5, 6, 7, 8) by the dispositions recorded in state.json. Finding 3 is plausible, and its recorded disposition is "No edit": the bundle directory is never edited by hand. So I made no change for it. That disposition leaves a note on session reports for the closeout's residue.

What changed, by finding:
- **Finding 1 (P2).** `envrcParts` in `src/lib/doctor/secrets.mjs` now runs `git ls-files` from `repo.top`. It reports a tracked `.envrc` in three places: at the top (`:(literal)` pathspecs), in each directory down to the config root, and anywhere under the root. It reports an untracked `.envrc` at the top, at each directory above the root, or at the root, using `rootFiles` on each directory. Paths are relative to the top. An untracked one above the root gets a new message, `secretsCarriers.envrcAbove`. Outside a work tree only the root is checked, as before. With the config at the top, the output is the same as before.
  - New test in `doctor.test.mjs`: a config under `apps/mobile/`, with tracked `.envrc` files at the top and at `apps/mobile/ios/`, and a sibling `apps/web/.envrc` that is ignored. After that, untracked `apps/.envrc` and `apps/mobile/.envrc`.
  - The setup skill's carriers recipe row and the skills.test QUOTED list gained the new message. The E-015 closure in the backlog and the secrets guide's carriers bullet now say only what the row reads.
- **Findings 0 and 4 (P2).** The setup skill's secrets pass, step 5, and the guide's step 5 now close on exit 0 when every name a proof kind can cover is proved. A name no kind covers, such as a key, stays `unproved` and that is expected: the agent names it, never adds it to the proof's `names`, and never drops it from the target. A skills.test case checks the sentence.
- **Finding 5.** The skill's description now names a secrets request. The skill's intro sends such a request straight to the secrets pass once no Level 0 row FAILs. Doc-sync required a guide in that commit, so the secrets guide's "Ask your agent" sentence says the same. A skills.test case checks it.
- **Finding 7.** Step 3 now says the `supabase` kind needs `supabase` in `packs`: offer the pack first, or use a `host` proof. A skills.test case checks it. I committed it with `COOKWRIGHT_SKIP=doc-sync` and gave the reason in the message: the guide already states this prerequisite.
- **Finding 2.** The guide's model bullet now says the resolved values are never added to the shell's environment or to cookwright's. A stale export stays in both and is removed only from the command's environment.
- **Finding 8.** The AGENTS.md Layout now names every secrets module: config, engine, envfile, proofs, recipients, redact, prompt, and in backends/ index, age, age-init, keychain and onepassword. I used `COOKWRIGHT_SKIP=doc-sync` here before checking whether a rule would fire (AGENTS.md is itself the doc). The skip was probably not needed; the message records it.
- **Finding 6.** The managed block's Secrets section gained a bullet against reading a value from the backend directly (`age -d`, `op read`, `op inject`, `security find-generic-password -w`) or opening the identity file. The block stays at v4. The guide's "What the agent is told" list has the same item, and block.test.mjs checks it. I ran `npx cookwright init` (core.hooksPath checked: .githooks) to refresh this repo's AGENTS.md and committed it in the same commit.

Measured:
- `npm test`: 38 files, 1075 tests, all pass (baseline 1070, plus 5 new).
- init's doctor readout on this repo: 22 checks, 22 PASS, level 0 complete.

Not run:
- `bash scripts/ci/fixture.sh`. The carriers change affects nested configs; the fixture's config is at the top, so its result should be unchanged.

Every commit staged named paths only. The state.json change and `.state.json.swp` were left alone.
