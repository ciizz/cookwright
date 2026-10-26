# Stage 5 kickoff — secrets: one child process, target proof, never a plaintext file

Written 2026-10-26, decisions taken the same day. The first prompt for a fresh session opened in this directory: read `CHARTER.md` (the Secrets decision and the judgment rules), `AGENTS.md`, `CLAUDE.local.md` (the origin repo's credential contract is the reference implementation, read-only), `docs/playbook.md`, `docs/dev/closeouts/stage-4.md` and the backlog entries E-015 and E-001, then enter plan mode. It runs as a bundle through the runner.

## Goal

A developer runs any command that needs a credential through cookwright, and the credential reaches that one command's environment and nothing else: never a plaintext file on disk, never a command line, never a shell export, never a transcript. Before the command starts, cookwright proves that the values it was handed belong to the target named on the command line, so a run called `prod` cannot act on `dev` or the other way round. The agent uses the same path as the developer and never sees a value.

The charter's sentence this delivers: "secrets that never touch disk". The three backends it names, 1Password `op`, the macOS Keychain and `age` with a passphrase-protected identity as the free universal path.

## What the origin repo proved, and what stage 5 generalises

The origin repo's contract, built over three bundles after two incidents (a stale export aimed a dev run at production; a process listing printed a password into a transcript):

- Credentials reach a script only through the environment, injected for the lifetime of one command by `op run` from a committed template of secret references, never from a file of values. The unprefixed fallback was deleted, not deprecated.
- A prefixed name records what the operator meant, not what they handed over, so every run proves the value: a committed, non-secret file names the project each target is, and the connection string must carry that project in a place that decides which database is reached (the pooler username or the direct host), never as a substring anywhere. A mismatch refuses before anything outbound runs.
- No credential on any command line: the password is moved out of the URL into the one child's environment. Tracing is turned off before the first expansion. Child output is redacted before it is shown.
- What it does not close: the injecting process's own environment block holds the values for the run, readable by a same-user process, and the child's does while it runs. Stated, not hidden.

Stage 5 lifts the mechanism, not the scripts (rule 4): one command in the package, the proofs as data and pure functions, the backends behind one interface. The origin repo's scripts stay its own until it migrates.

## What stage 5 decides and what it builds

### The command

`npx cookwright run <target> -- <command…>` is the one way a credential reaches a process. It reads `secrets` in `cookwright.json`, resolves the target's values through the declared backend into cookwright's own memory (a pipe, never its environment and never a file), proves each value the target declares a proof for, scrubs every declared secret name of every target from the environment it inherited (a stale export is dropped, not used), spawns the one child with the values in that child's environment only, and exits with the child's status.

Before the child starts it prints one banner line: the target, the names injected, which of them were proved and against what public identifier. Never a value. A missing backend tool, a missing name, a failed proof: one line naming the fix, exit 1, nothing spawned. This is not a hook; refusing is the point (rule 1 governs hooks, and `run` is the user's own command).

The child's stdout and stderr pass through a redactor that replaces any injected value, and its percent-encoded form, with `<NAME>`. Whether redaction costs the child its terminal (colour, a pager, a prompt) and how that is handled is the plan's; the guarantee is not negotiable.

### The config

```json
"secrets": {
  "backend": "age",
  "targets": {
    "dev":  { "names": ["SUPABASE_URL", "DB_URL", "SERVICE_ROLE_KEY"], "proof": { "kind": "supabase", "ref": "<project ref>" } },
    "prod": { "names": ["SUPABASE_URL", "DB_URL", "SERVICE_ROLE_KEY"], "proof": { "kind": "supabase", "ref": "<project ref>" } }
  }
}
```

A target declares the names the child may expect, so a script's contract is readable without a vault, and `run` refuses before spawning when the backend lacks one. The proof names a public identifier, never a secret, and the kind that knows where that identifier must appear. Config version 4 adds the key; the migration writes nothing (no `secrets` means no backend, Level 2 off, as the charter says).

### Target proof

A proof kind is a pure function `(values, proof) → { ok, reason }` over the resolved values, and a kind lives where the knowledge lives:

- Core: `host`, the URL in `<name>` has exactly the declared host.
- The `supabase` pack: `supabase`, lifted from the origin repo's anchored check. The project URL's host is `<ref>.supabase.co`; the database URL carries the ref as the pooler username's suffix (`<role>.<ref>`) or as the direct host (`db.<ref>.supabase.co`), and nowhere else counts. A ref that merely appears in a password, a path or a query string is a mismatch. The pack manifest gains `proofs`, data and pure functions as stage 4 made it (importing nothing).

A target without a proof is a chosen state: doctor WARNs it and the banner says `unproved`. A declared proof that fails refuses the run.

### The backends

One interface: `resolve(target) → Map<name, value>` in memory, plus what doctor can measure without prompting and what `secrets set` needs to write. Every backend reaches its tool through `probes` so the engine is tested with a fake and each tool once for real.

- **`1password`.** A committed template per target, `secrets/<target>.env.tpl`, holding `NAME=op://<vault>/<item>/<field>` lines and nothing else. `run` resolves it with `op inject` to a pipe, never `op run` (which would inject before the proof could read a value). A template line with a literal value is a plaintext env file by another name: doctor FAILs it and `run` refuses it. Needs `op` on PATH; sign-in state is not measured by doctor (it would prompt), only by `run`.
- **`keychain`** (darwin). One keychain item per name: service `cookwright/<target>`, account `<NAME>`, read with `security find-generic-password -w`. `npx cookwright secrets set <target> <NAME>` reads the value from a prompt with echo off, never from an argument, and writes it with `security add-generic-password -U`. The OS owns the unlock prompt. On another platform the backend reads SKIP with the reason, never FAIL.
- **`age`.** The ciphertext `secrets/<target>.env.age`, encrypted to every public key in `secrets/recipients.txt`; the identity at `~/.config/cookwright/identity.age`, itself passphrase-encrypted (`age -p`), or the path `COOKWRIGHT_AGE_IDENTITY` names. `run` decrypts the identity then the file, both to memory. `secrets set` decrypts to memory, replaces the one line, re-encrypts to the recipients and writes the ciphertext; a plaintext temp file is never created. `secrets init` generates the identity and the recipients file with consent. An identity that is not passphrase-protected is a chosen state: WARN, naming the upgrade. Needs `age` and `age-keygen`.

A backend's tool missing: doctor `secrets.backend` reads SKIP with the install line; `run` refuses with the same line.

### Doctor

New rows under `secrets.`, beside the existing `secrets.env` (which stays as it is: no plaintext env file tracked, none at the root, the two patterns ignored):

- `secrets.backend` — the declared backend's tool on PATH, and on this platform; absent SKIP, wrong platform SKIP, none declared PASS `no backend (Level 2 off)`.
- `secrets.targets` — per target, what exists without a prompt: the template parsed and literal-free (`1password`), the ciphertext and recipients present (`age`), the items present by name (`keychain`, `security` lists without unlocking); names declared in config against names the template holds; a target with no proof named as WARN.
- `secrets.carriers` — E-015: a tracked or root-level `.envrc`, and any declared secret name present in doctor's own environment (a shell that exported one). WARN with the name, never the value.

All three within the 1800 ms budget; a backend call that could prompt is never made by doctor (rule 3: it says `not measured`, not PASS).

### Rules and the agent

The managed block's Secrets section grows by what the agent must do: a command that needs a credential runs through `npx cookwright run <target> -- …`; never `export` one, never write `.env`, never pass one as an argument, never print a process's command line or environment, never run `run` with a target the developer did not name in the session. A block version bump, refreshed by init as every block change is.

The setup skill gains the rows' recipes: choosing a backend (the free path first, the OS keystore as the upgrade on darwin, 1Password when the developer already has it), `secrets init`, `secrets set` per name, writing a target with its proof, and the first `run` against a harmless command (`env | grep -c NAME` is not harmless; the recipe uses one that prints nothing).

### The escape

There is none for `run` itself: a refused proof or a missing name is the product. The developer can always run the command without cookwright; what they cannot do is make cookwright inject an unproved value into a proved target. The hooks are unchanged.

### What stays stated, not closed

The injecting process holds the values in memory for the run and the child's environment block holds them while it runs; a same-user process can read the child's. Closing it needs a re-exec with a scrubbed environment and is not stage 5's. The guide says so in one paragraph, as the origin repo's contract does.

## Scope

1. `secrets` in the config, the schema, config version 4 and its migration.
2. `npx cookwright run <target> -- <command…>`: resolve, scrub, prove, spawn once, redact, exit with the child's status.
3. The three backends behind one interface, each reachable through `probes`; `secrets init` and `secrets set` for `age` and `keychain` (1Password items are written in 1Password).
4. Target proof: the core `host` kind, the `supabase` kind in the pack manifest, lifted anchored.
5. The three doctor rows and E-015.
6. The Secrets section of the managed block, the setup skill's recipes, a `secrets` guide (the three backends, the proof, what is not closed, moving an existing app off its `.env`), getting-started and README updated.
7. Measured: the engine on a fake backend; `age` end to end in the fixture on ubuntu with a throwaway identity (a passphrase-less one, the WARN asserted); `keychain` end to end on the macOS CI job; `1password` by hand on the developer's machine, recorded in the closeout with its output; the `supabase` proof on synthetic URLs covering every anchor and every near-miss the origin repo's review found (the ref in a password, a path, a query string, a database name). The origin repo is read for the shapes and never run.
8. Closeout `docs/dev/closeouts/stage-5.md`, release 0.3.0 in the release order.

## Out of scope

The Supabase ops pack (E-001: the read-only role, the status script, encrypted dumps) and the OTA preflight; both are `run` users and come after it. A Linux secret-service or Windows Credential Manager backend (later backends, the charter's "OS keystores as a doctor-suggested upgrade"). The re-exec that would scrub the injecting process's own environment. A gate check that needs a credential. B-018 (in flight from stage 4). Any change to the hooks.

## Decisions taken 2026-10-26

1. **Secrets sit beside the levels, not on the ladder.** `secrets` is a config key orthogonal to the level, as `packs` is, measured by its own `secrets.*` rows whatever the level reads; Level 2's requirement list claims those rows when Level 2 opens. No charter amendment: the charter's Level 2 placement stands, and Level 1 (atlas, SQL suites) stays unbuilt without a hole in the ladder.
2. **The `age` ciphertext is tracked.** `secrets/<target>.env.age` and `secrets/recipients.txt` are committed, so a clone plus the identity is a working machine and the repo holds the state. The identity, passphrase-protected and outside the repo, is the only secret.
3. **Proof is required to read PASS.** A target without a proof is WARN in doctor and `unproved` on the banner (rule 2: a chosen state, with the reason), so a Supabase target that skipped its ref is visible on every readout.

## Standard

Plan mode first, a written plan, adversarial review of the plan (P1 and P2 findings only; P3 goes to the plan's residue list), implementation, review of the diff per slice, QA on the fixture, the macOS job and the developer's machine, closeout. Every disposition cites a judgment rule by number. The three decisions above are taken; nothing needs the developer until the plan review. Nothing in this stage prints a value, in a test, a fixture log, a transcript or a closeout; a test that needs to show a value injected asserts on its length or its hash.
