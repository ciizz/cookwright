# QA round 2 (the developer, 2026-10-29): 1Password, keychain, the environment block

On a fresh kept fixture tree (`KEEP=1 bash scripts/ci/fixture.sh` at fc2ea0eb, PASS; the earlier tree was cleared by a reboot), in the developer's own terminal, with throwaway values only. The developer's shell exports `SUPABASE_DB_URL` and `~/.zshrc` sets it (names only).

## 1Password (`op` 2.39.0, a vault and an item each with a space in the name)

- Doctor, template committed: `PASS secrets.backend op on PATH`; `WARN secrets.targets dev: template tracked, one reference per name; prod: no template (…)`; `WARN secrets.carriers exported in this environment: SUPABASE_DB_URL …; a line setting SUPABASE_DB_URL in ~/.zshrc …` (correct: the developer's shell).
- `run dev -- true`: **refused, exit 125**, `run: op inject failed: [ERROR] … expected data on stdin but none found; sign in (op signin, or unlock the 1Password app) and run it again`. The 1Password app was unlocked with CLI integration on.
- A literal line appended (`SERVICE_ROLE_KEY=literal`, line 4): `run` refused, exit 125, `line(s) 4 of secrets/dev.env.tpl hold neither an op:// reference, a blank nor a comment: replace each with a reference`, the line never printed; doctor `FAIL secrets.targets dev: line(s) 4 … a literal value? …`. As designed.

## Keychain (`secrets.id` `qa`)

- Steps 6 to 11 reported by the developer as expected: `secrets set dev SERVICE_ROLE_KEY` with a 240-character value pasted at the hidden prompt, `SUPABASE_URL` and `DB_URL` typed at it; `run dev -- sh -c 'echo ${#SERVICE_ROLE_KEY}'` printed the length with exit 0; `security lock-keychain` then doctor's `secrets.targets` with no dialog and no hang reported.
- `run dev -- sleep 30 &`: banner `run: dev · injected SUPABASE_URL, DB_URL, SERVICE_ROLE_KEY · proved SUPABASE_URL, DB_URL against fixturefixturefixtur (supabase) · unproved SERVICE_ROLE_KEY · dropped from the environment: SUPABASE_DB_URL · uncommitted: cookwright.json · keychain service cookwright/qa/dev · child output piped through the redactor (no terminal on stdout/stderr)`.

## The environment block

- `ps eww -p <the child sleep's pid> | grep -c DB_URL` printed `0` on macOS (Darwin 27.2.0), the process owned by the same user: `ps eww` did not show the child's environment.

## Findings

- **P1, the 1Password backend cannot resolve anything on macOS.** Measured by the orchestrator in the scratchpad, with a template holding no reference: `spawnSync('op', ['inject','-f'], { input })` fails with `expected data on stdin but none found`, while the same text piped by a shell reaches `op`'s next step. Node's child stdin under `input` is a Unix socket (`fstatSync(0).isSocket()` true, `isFIFO()` false), and `op` requires a pipe. The unit tests used a fake `op` through `probes.capture` and could not see it. Fix: write the `NAME={{ op://… }}` lines (references only, already committed in the template) to a private temporary file, mode 600 in a 700 directory under the OS temp folder, pass it with `op inject -f -i <file>`, and remove it in a `finally`; a regression test with a fake `op` script on PATH that refuses a stdin that is not a FIFO and reads `-i`'s file; the guide's sentence on how `op inject` is fed. The refusal's sign-in hint should be given only when `op`'s first line is about sign-in, else `op`'s line alone.
- **P3 ×2, carried from qa run 1's review:** the setup skill's `secrets init` sentence follows the new order (an existing passphrase-protected identity: age asks for the passphrase first, consent after; an already-held key asks nothing more and writes nothing); the guide's "asks nothing" becomes "asks for no consent".
- **Measured, for the guide:** the "What is not closed" paragraph can say that on macOS `ps eww` did not show a same-user child's environment (measured 2026-10-29), keeping `/proc/<pid>/environ` for Linux; the residual stands as stated for other readers of a process's memory.

Not measured, and the closeout says so: the guide's psql wrapper against a real database.
