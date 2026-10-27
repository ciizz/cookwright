# implement:s2 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `65fdc93 feat: run injects a target's secrets into one child, after its proof`
- `906c9c6 feat: secrets init and set on the age backend, the value never an argument`
- `b7b6ed0 test: secrets init and set through the command: consent, the recipients rule, the ignore refusal, the hidden prompt`
- `b0ad6a6 test: the fixture runs the age backend end to end; CI installs age sha256-pinned`

## Files
- `packages/cookwright/src/run.mjs`
- `packages/cookwright/src/run.test.mjs`
- `packages/cookwright/src/secrets.mjs`
- `packages/cookwright/src/secrets.test.mjs`
- `packages/cookwright/src/cli-main.mjs`
- `packages/cookwright/src/cli-main.test.mjs`
- `packages/cookwright/src/lib/probes.mjs`
- `packages/cookwright/src/lib/probes.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/messages.test.mjs`
- `packages/cookwright/src/lib/secret/config.mjs`
- `packages/cookwright/src/lib/secret/engine.mjs`
- `packages/cookwright/src/lib/secret/engine.test.mjs`
- `packages/cookwright/src/lib/secret/prompt.mjs`
- `packages/cookwright/src/lib/secret/prompt.test.mjs`
- `packages/cookwright/src/lib/secret/backends/index.mjs`
- `packages/cookwright/src/lib/secret/backends/age.mjs`
- `packages/cookwright/src/lib/secret/backends/age-init.mjs`
- `packages/cookwright/src/lib/secret/backends/age.test.mjs`
- `docs/guides/secrets.md`
- `scripts/ci/fixture.sh`
- `.github/workflows/ci.yml`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.run.usage` | usage: npx cookwright run <target> -- <command> [argument…] | run's usage, exit 2 |
| `messages.run.refused` | run: <detail> | prefix of every run refusal |
| `messages.run.noConfig` | no cookwright.json at or above <cwd>; run npx cookwright init | run without a config, exit 2 |
| `messages.run.configInvalid` | cookwright.json invalid: <detail>; run npx cookwright doctor | run with an invalid config, exit 2 |
| `messages.run.head/injected/proved/unproved/dropped/uncommitted` | run: <target> · injected A, B · proved A against <ref> (<kind>) · unproved B · dropped from the environment: X, Y · uncommitted: cookwright.json | the banner's parts, joined with ' · ', on stderr |
| `messages.run.uncommittedUnknown` | uncommitted: not measured (git status failed) | banner part when git status fails |
| `messages.run.piped` | child output piped through the redactor (no terminal on stdout/stderr) | the banner's last part, always |
| `messages.run.argValue` | argument <i> holds the value of <NAME>; read it from the environment inside the command instead | argv check refusal, exit 125 |
| `messages.run.argUrl` | argument <i> is a URL with a password; declare it as a secret and read it from the environment inside the command instead | URL-with-password argv refusal, exit 125 |
| `messages.run.notStarted` | <cmd> could not be started (<code>) | spawn failure, exit 127 |
| `messages.secrets.usage` | usage: npx cookwright secrets init [--no-passphrase] [--yes] | secrets set <target> <NAME> [--stdin] | secrets usage, exit 2 |
| `messages.secrets.refused / noConfig / configInvalid` | secrets: <detail> / no cookwright.json at or above <cwd>; run npx cookwright init / cookwright.json invalid: <detail>; run npx cookwright doctor | secrets command refusals |
| `messages.secrets.none` | no secrets backend declared in cookwright.json (Level 2 off; the secrets guide shows the key) | run/secrets with no secrets key, exit 125 |
| `messages.secrets.unknownTarget` | no target <name> in cookwright.json (declared: a, b) | (none declared) | unknown target, exit 125 |
| `messages.secrets.noBackend` | the <name> backend is not available in this version of cookwright | backend not registered (keychain, 1password until s3) |
| `messages.secrets.needsTool` | needs <tool>: <install line> | an operation's tool missing, exit 125 |
| `messages.secrets.platform` | the <backend> backend runs on <platforms> only | wrong platform, exit 125 |
| `messages.secrets.missingName` | <NAME> is missing or empty for <target>: npx cookwright secrets set <target> <NAME> | a declared name the backend lacks |
| `messages.secrets.resolved` | <target>: <envfile problem>; re-set the values with npx cookwright secrets set | malformed resolved text |
| `messages.secrets.timedOut` | <tool> did not answer in time | a capture timing out |
| `messages.secrets.undeclared` | <NAME> is not one of <target>'s names (secrets.targets.<target>.names in cookwright.json): declare it first | secrets set with an undeclared name |
| `messages.secrets.notWorkTree` | the directory holding cookwright.json is not inside a git work tree (the recipients file is reviewed in a commit) | secrets init/set outside a work tree |
| `messages.secrets.set` | secrets: set <NAME> for <target> (<backend>) | secrets set success line |
| `messages.secrets.encryptedTo` | secrets: encrypted to <n> recipient(s): …tail1, …tail2 | after secrets set, the recipients' last eight characters |
| `messages.secrets.prompt.value` | <NAME> for <target> (input hidden):  | hidden value prompt on stderr |
| `messages.secrets.prompt.noTerminal` | no terminal to read the value from: run this in your terminal, or pipe one line with --stdin | secrets set without a tty and without --stdin |
| `messages.secrets.prompt.cancelled / eof / empty / oneLine / nul / tooLong` | cancelled; nothing written / the input ended before a line was entered; nothing written / the value is empty; nothing written / a value is one line, and the input holds more than one; nothing written / the value holds a NUL byte; nothing written / the input is longer than <max> bytes; nothing written | readValue refusals |
| `messages.secrets.prompt.proceed` | proceed? [y/N]  | secrets init consent question |
| `messages.secrets.age.install` | brew install age (or the age package of your system) | age install line in needsTool |
| `messages.secrets.age.noIdentity` | no age identity at <path>: npx cookwright secrets init writes one (on another machine, copy the identity you already have there) | run/set without an identity |
| `messages.secrets.age.protectedNoTerminal` | the identity is passphrase-protected; hand this command to the developer | disposition 67's line, no terminal |
| `messages.secrets.age.failed` | <age -d|age -e|age -p|age-keygen> failed: <first stderr line> | a tool call failing |
| `messages.secrets.age.multiLine` | <NAME>: a value is one line, with no NUL byte; nothing written | set with a multi-line value |
| `messages.secrets.age.identityExists` | an age identity already exists at <path>; one identity per developer, so init writes none (a second machine copies it, the secrets guide says how) | init preflight |
| `messages.secrets.age.inWorkTree` | <dir> is inside the git work tree <top>, and an identity never lives in a repo: set COOKWRIGHT_AGE_IDENTITY to a path outside every work tree | init preflight, disposition 51 |
| `messages.secrets.age.gitProbe` | could not tell whether the identity's directory is inside a git work tree: <detail> | rev-parse probe failure |
| `messages.secrets.age.ignored` | <rel> is ignored by git (<source>:<line>: <pattern>); remove that line, so the ciphertext and recipients can be committed; nothing written | init ignore refusal, disposition 42 |
| `messages.secrets.age.notWritable` | <dir> is not writable; nothing written | init preflight |
| `messages.secrets.age.passphraseTerminal` | secrets init asks for the passphrase on a terminal; hand this command to the developer | init without a terminal, no --no-passphrase |
| `messages.secrets.age.consentTerminal` | secrets init asks for consent on a terminal; hand this command to the developer, or pass --yes | init without a terminal and without --yes |
| `messages.secrets.age.declined` | not confirmed; nothing written | init consent declined |
| `messages.secrets.age.noPublicKey` | age-keygen printed no public key; nothing written | init keygen parse failure |
| `messages.secrets.age.autogenerated` | age generated the passphrase because an empty one was typed; nothing kept: run init again and type a passphrase | init: age's autogenerated line seen on stderr (see open question) |
| `messages.secrets.age.notProtected` | age did not write a passphrase-protected identity; nothing kept | init header check after age -p |
| `messages.secrets.age.removed` | secrets: removed <path> | init cleanup after a late failure |
| `messages.secrets.age.willWrite / willIdentity / willRecipients` | secrets: init will write / <path>, the age identity, passphrase-protected (age asks for the passphrase next, on this terminal; an empty one makes age generate one and print it here once) | with no passphrase (weaker: whoever reads the file opens every secret) / its public key, appended to <rel> | <rel>, holding its public key | init's consent text |
| `messages.secrets.age.held` | <rel> already holds <n> recipient(s) (…tails): one identity per developer, so on a second machine copy your identity instead of running init; a new recipient cannot read what is already encrypted until each value is set again | init on a repo whose recipients hold a key, disposition 46 |
| `messages.secrets.age.wroteIdentity` | secrets: wrote <path> (passphrase-protected, mode 600) | (no passphrase, mode 600: weaker; the secrets guide shows how to add one) | init success |
| `messages.secrets.age.wroteRecipients` | secrets: <rel> holds <n> recipient(s): …tails | init success |
| `messages.secrets.age.commitFirst` | secrets: commit <rel> before the first secrets set (git add <rel> && git commit) | init's last line |
| `docs/guides/secrets.md` | New sections 'Running a command with a target's secrets' and 'The age backend' | the guide's run and age sections |
| `scripts/ci/fixture.sh MSG_SECRETS_SKIP` | secrets: skipped, needs <tool> | fixture's step-local skip without age |

## Open questions
- Disposition 10 conflicts with a measurement. On age 1.3.2 (measured under a pty in this session), an empty passphrase makes `age -p` print `age: using autogenerated passphrase "…"` to the terminal it opened (/dev/tty), not to stderr. So the plan's check, which captures stderr and refuses on that line, cannot fire on a real terminal. It fires only where age has no terminal to print to. The check is kept in age-init.mjs, and the module header records the measurement. The consent line and the guide now state the measured behaviour: an empty passphrase makes age generate one and print it once on the terminal, so keep it. Refusing an empty passphrase would need cookwright to handle the passphrase, which the charter's decision forbids. Two options for the developer: accept an autogenerated passphrase (the current text), or keep the plan's refusal by some other mechanism.
- The `secrets.age.inspect` doctor operation was not built in s2. The three doctor rows, the second doctor run in the fixture, and planting `export SUPABASE_DB_URL=` in the scratch .zshrc are s3's checkpoint. s2 applied disposition 63's isolation (an empty HOME and the declared and ambient names unset) to the existing doctor run and to the secrets step.
- The redactor uses the same needle list as the argv check: resolved values plus inherited values of 8 or more characters for declared and ambient names. An old value the shell still exports is therefore also replaced in the child's output, and the guide says so. Plan §4.5 names the inherited needles only for the argv check. Confirm this widening.
- A local measurement: this machine exports SUPABASE_DB_URL as the local stack URL. Because inherited values are needles (disposition 22), `run dev -- psql postgresql://postgres:postgres@127.0.0.1:54322/postgres` is refused on this machine, naming SUPABASE_DB_URL, even though the loopback shape passes (disposition 43 keeps the needle check on loopback hosts). The fixture now unsets those names in its secrets step. Should the guide or the s3 carriers row say this?
- The backend interface is set in s2 for s3 to follow: `set(target, name, ctx)` reads the value through `ctx.readValue()` after the backend's own checks, so nothing is asked before a refusal. `files(target)` lists the files for the banner's uncommitted part, and an optional `bannerParts(target, config)` covers the keychain service. `init` lives in backends/age-init.mjs, and backends/index.mjs builds the age backend from the two modules. For now the keychain and 1password backends refuse with `the <name> backend is not available in this version of cookwright` until s3 registers them.
- AGENTS.md Layout describes the fixture's steps and does not yet name the secrets step or the age install. Updating Layout is s5's scope, so it was left untouched.

## Notes
s2 is done in four checkpoint commits, each staging named paths only. Measured at the end: `npm test` has 36 files and 939 tests, all passing; the baseline was 870. `bash scripts/ci/fixture.sh` ran locally to `fixture: PASS, every step as expected` with age 1.3.2 and gitleaks on PATH. In that run the pre-commit secrets scan passed on the armored ciphertext. The step's skip without age (exit 0) and its failure under FIXTURE_STRICT=1 were checked by running the function with a PATH that has no age.

Layout follows the recorded deviation: modules live in src/lib/secret/ and src/lib/secret/backends/. SCANNED gains src/run.mjs, src/secrets.mjs and src/lib/secret/backends. ALLOWED gains one entry, age's armor line, which is a file format and not a message.

What was built:
- **Engine** (lib/secret/engine.mjs):
  - `Refused` exits 125.
  - Two environments, with the LIBPQ_NAMES drop that fix:model asked for, named on the banner.
  - The argv check, with inherited needles and the loopback exemption.
  - `git status` uncommitted files read top-relative. The config root is resolved to a real path through `realRoot`, because the old symlinked-tmpdir mismatch would otherwise hide them.
  - The banner on stderr.
  - The redactor on both pipes, with backpressure. On a downstream EPIPE the child's pipe is closed, so the child meets a closed pipe as in a shell pipeline.
  - SIGINT is ignored and SIGTERM and SIGHUP are forwarded. Exit codes are 125, 127 and 128+n.
  - `prove` gets the target's names (fix:model note).
- **Probes:** `capture` (sync, 120 s cap, `cap: null` uncapped), `spawnChild` (async, no shell), `terminal` (/dev/tty opens), and `ignoredBy`. `ignoredBy` uses `check-ignore -v --no-index`, so a refusal names the .gitignore line; a negation pattern reads as not ignored, as measured.
- **age backend:** `resolve`, `set` and `init` with the full preflight. The identity is placed per disposition 6 and checked against any enclosing work tree by realpath. That probe runs with LC_ALL=C, and only `not a git repository` passes. The identity is created mode 600 before age writes into it, in a directory created 700. A failure after the write removes the identity.
- **Commands:** `secrets init|set`, with `readValue` (raw-mode hidden input, the terminal restored in every case) and `confirm`.

The guide gains the run and age sections. The CI fixture job installs age 1.3.2: the asset sha256 cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 was computed locally from the downloaded tarball and matches the digest in GitHub's release API.

The auto-mode classifier denied two actions:
- editing ci.yml through a shell script (done instead with the Edit tool);
- `rm -rf` of a kept fixture temp dir under /var/folders (…/cookwright-fixture.ayxN6s, left from a KEEP=1 run). It is still there; the developer can delete it.

Nothing left the repo except one download of the public age release tarball and one GitHub API read, both to pin the digest. The developer's hands: pushing bundle/stage-5 (`git push origin bundle/stage-5`) is what runs the CI fixture with the new age step.
