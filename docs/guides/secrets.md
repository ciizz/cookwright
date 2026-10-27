# Secrets

A secret never touches disk in plaintext, and no env file stands in for one, not even as a fallback. cookwright reads a target's secrets from a backend and injects them into one child process, after checking that the values name the target you asked for (its proof). With no backend declared, Level 2 is off and nothing here applies.

## The model

cookwright's secrets were built after two things went wrong in a real dev loop: a value exported long before aimed a dev command at production, and a password on a command line showed up in a process listing, then in an agent's transcript. So:

- A secret lives in a backend (an encrypted file, the macOS keychain, 1Password), never in a plaintext file in the repo or beside it.
- A *target* (`dev`, `prod`) names the secrets one environment needs. `npx cookwright run <target> -- <command>` reads that target's values, checks that they point where the target says (its *proof*: the Supabase project ref, or a host), and hands them to the environment of that one command. The values are never added to your shell's environment or to cookwright's own: they stay in cookwright's memory until the command starts. A stale export of a declared name is not removed from your shell or from cookwright's own environment, only from the command's (next point).
- What the command must not inherit is taken out of its environment and named on the banner: every name any target declares (so a stale `export DB_URL=…` never reaches a dev run), the names the stack's own tools read (`SUPABASE_DB_URL`, libpq's `PG*`), and the backend's own credentials.
- An argument holding a value is refused, and the command's output passes through a redactor.
- Doctor checks the setup, the files and your shell's rc files by name, without reading a value.

What this leaves open is listed under "What is not closed" below.

## Setting up, in order

1. Choose a backend and write it into `cookwright.json` with no target yet: `"secrets": { "backend": "age", "targets": {} }`. `age` first (free, on every platform); `keychain` on macOS when you want nothing of it in the repo (with `"id"`); `1password` when you already use `op`.
2. `age` only: `npx cookwright secrets init`, then commit `secrets/recipients.txt`.
3. Declare a target, its `names` and its proof (for Supabase, the ref from your dashboard URL). For `1password`, write its template.
4. `age` and `keychain`: `npx cookwright secrets set <target> <NAME>` per name; for `age`, commit `secrets/<target>.env.age`.
5. `npx cookwright run <target> -- true`: the banner names what was injected and what was proved; exit 0 with every name a proof kind can cover proved means the target works. A name no kind covers (a key, such as Supabase's `service_role` key) stays unproved on the banner, and that is expected: keep it in the target, and don't add it to the proof's `names`, which would refuse every run.

Ask your agent to set up secrets and the `setup` skill walks these five steps with you, one at a time, running doctor after each; a FAIL among doctor's Level 0 rows is cleared first, and the rest of its walkthrough waits until you ask for it. It writes the config and the template; the commands that read a value or a passphrase on your terminal (`secrets init`, `secrets set`, and `run` with a passphrase-protected identity) it hands to you, and the commits are yours.

## Choosing a backend

| | `age` | `keychain` | `1password` |
|---|---|---|---|
| The values live in | `secrets/<target>.env.age`, encrypted, committed | your default macOS keychain | your 1Password vaults |
| In the repo | the ciphertext and `secrets/recipients.txt` | nothing | `secrets/<target>.env.tpl`, references only |
| The one thing to guard | the identity, a file outside every repo | your macOS login | your 1Password account |
| Runs on | anywhere `age` runs | macOS | anywhere `op` runs |
| You write values with | `secrets init` once, then `secrets set` | `secrets set` (`secrets.id` required) | 1Password itself, plus a template |

`age` is the default: free, the same on every machine, and the ciphertext travels with the repo. `keychain` suits a Mac-only setup that wants nothing of it in the repo. `1password` suits a developer whose values are in 1Password already. The sections below take each in turn.

## The config

`secrets` in `cookwright.json` declares the backend and the targets. It is optional and has no default; format version 4 added it.

```json
"packs": ["supabase"],
"secrets": {
  "backend": "age",
  "targets": {
    "dev": {
      "names": ["SUPABASE_URL", "DB_URL", "SERVICE_ROLE_KEY"],
      "proof": { "kind": "supabase", "ref": "abcdefghijklmnopqrst" }
    },
    "prod": {
      "names": ["SUPABASE_URL", "DB_URL", "SERVICE_ROLE_KEY"],
      "proof": { "kind": "supabase", "ref": "tsrqponmlkjihgfedcba" }
    }
  }
}
```

- `backend`: `age` (an encrypted file in the repo, the identity that opens it outside the repo), `keychain` (macOS) or `1password` (`op`).
- `id`: this repo's name among your repos, lowercase letters, digits and dashes. The keychain backend names its items `cookwright/<id>/<target>`, so it is required with `keychain` and optional otherwise. There is no default: two repos with the same directory name must never share an item.
- `targets`: the targets by name (lowercase letters, digits and dashes, starting with a letter). An empty object is valid while you set up. Each target lists its secret `names` (uppercase letters, digits and `_`, starting with a letter, each once) and may declare a `proof`.

A target without a proof runs, and is reported as unproved. A target with a proof refuses to run when a value it covers does not satisfy it.

`schema/cookwright.schema.json` (the `$schema` your editor reads) checks the shape only. It cannot see which packs you declared, so it accepts `"kind": "supabase"` without the supabase pack; the loader, doctor and every command refuse it, naming the pack to add to `packs`.

## Proof kinds

A proof covers the names it lists, and a covered value that does not satisfy the kind is a mismatch, never skipped. Nothing is inferred from a value's shape: a Sentry DSN beside a Supabase URL is a declared name with no proof, and it is reported unproved.

**`host`**, in the core: `{ "kind": "host", "host": "api.example.com", "names": ["API_URL"] }`. `names` is required. Each covered value must be a URL whose host is `host`, both read the way `new URL` reads a host: case does not matter, a trailing dot is dropped and an IDN compares by its punycode. `host` is read as an https host, so `:443` in it is dropped; a value's port is read for the value's own scheme, so only that scheme's default port is dropped (`https://api.example.com:443` is `api.example.com`, `http://api.example.com:443` is not). Any other port is part of the host, so a database URL on `db.example.com:5432` needs `"host": "db.example.com:5432"`. `host` is a bare host: no scheme, path or user.

**`supabase`**, from the supabase pack (declare it in `packs`): `{ "kind": "supabase", "ref": "<project ref>" }`. `ref` is the 20 lowercase letters in your project's dashboard URL. Without `names`, the proof covers whichever of `SUPABASE_URL` and `DB_URL` the target declares, and is invalid when it declares neither. A covered value passes when it is:

- a project URL, `https://<ref>.supabase.co`;
- a database URL naming the ref as the pooler user `<role>.<ref>` (`postgres.<ref>`) on a single host ending in `.pooler.supabase.com`, or as the direct host `db.<ref>.supabase.co`. When a URL has both a `<role>.<x>` user and a `db.<y>.supabase.co` host, x and y must both be the ref.

The ref anywhere else (the password, the path, the database name, the query string, a longer user name) proves nothing. The user part ends at the last `@` and is read by hand, not by `new URL`. A refusal names the secret, the expected ref and the anchor that failed. It names a ref it found only when the value has a `*.supabase.co` host, and never prints a value, a host or a password.

**The query-string rule, for both kinds.** A `postgres://` or `postgresql://` value is a mismatch when its query string sets a parameter that libpq lets override the URL's own host, user or credentials: `host`, `hostaddr`, `user`, `port`, `dbname`, `service`, `options`, `password` or `passfile`. Names are percent-decoded first, as libpq decodes them, so `?pass%77ord=` counts as `password`. `sslmode` and `application_name` pass. A user part holding an unencoded `/`, `?`, `#` or `@` is a mismatch too: libpq and a last-`@` reading would disagree on where the host starts. Percent-encode such a character in a password (`%40` for `@`). A host part listing more than one host (a comma, or `%2C`, as in `a.example,b.example:5432`) is a mismatch as well: libpq tries the hosts in order, so a proof that anchors one of them would not say where the run connects. For the same reason, the environment's libpq names (`PGHOSTADDR`, `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGOPTIONS`, `PGPASSWORD`, `PGPASSFILE`, `PGSERVICE`, `PGSERVICEFILE`) never reach a child that receives a postgres URL: a stale `export PGHOSTADDR=…` would otherwise pick the address libpq connects to, whatever host the proved URL names.

## Running a command with a target's secrets

```
npx cookwright run dev -- npm run seed
```

Everything after the first `--` is the command, word for word, flags included. It runs without a shell; write `-- sh -c '…'` when you need one.

Before the command starts, cookwright:

1. reads the target's values from the backend. The backend's own tool (`age`, `op`, `security`) runs with your environment minus every name any target declares and every name the declared packs' tools read on their own (the supabase pack's `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN` and libpq's `PG*` names), so a stale export never reaches it;
2. checks each declared name has a value, and the target's proof;
3. builds the command's environment: yours, minus the names above, minus the backend's own control names (`COOKWRIGHT_AGE_IDENTITY` for age), minus libpq's names when a value is a postgres URL, minus any variable whose value equals one of the target's values, then the target's values added;
4. refuses a command line that holds a value: see below.

The banner, on stderr so the command's stdout stays clean, says what happened:

```
run: dev · injected SUPABASE_URL, DB_URL, SERVICE_ROLE_KEY · proved SUPABASE_URL, DB_URL against abcdefghijklmnopqrst (supabase) · unproved SERVICE_ROLE_KEY · dropped from the environment: DB_URL, SUPABASE_DB_URL · uncommitted: cookwright.json · child output piped through the redactor (no terminal on stdout/stderr)
```

`dropped from the environment` names every variable of yours that the command does not receive as you had it. `uncommitted` names `cookwright.json` or the target's backend file when it differs from your last commit: a target edited and run before it is committed is your own edit, so `run` names it rather than refusing.

**Exit codes.** A refusal before the command starts exits 125 with one line saying why, and nothing runs. A command that cannot be started exits 127. Otherwise `run` exits with the command's own status, or 128 plus the signal's number when a signal ended it, as a shell does. Ctrl-C reaches the command (cookwright ignores it while the command runs); a SIGTERM or SIGHUP sent to cookwright is passed on to the command.

**A value on the command line is refused.** `-- psql "$DB_URL"` is expanded by your shell before cookwright starts, so the URL would sit on psql's command line, where any process listing shows it, and if your shell still exports an old `DB_URL`, it would be that one, under the dev banner. `run` refuses an argument that holds a target's value (or its URL-encoded form, or a URL's password), or the value of a declared or ambient name your shell still exports (8 characters or more, unless it is the local Supabase stack's public default: a URL on a loopback host whose password is `postgres`, or `PGPASSWORD=postgres`; any other loopback URL, such as a tunnel to production on `localhost`, is still refused), and any `scheme://user:password@host` argument, naming its position, never the argument: `argument 2 holds the value of DB_URL; read it from the environment inside the command instead`. A URL with a password whose host is exactly `localhost`, a `127.x.x.x` address, `[::1]` or `host.docker.internal`, at most followed by a numeric port (the local Supabase stack's `postgres:postgres`), passes that shape check; any other host, `[::1].evil.example` or `127.999.0.1` among them, does not. Write the command so it reads the variable itself: a script, an npm script, or a program that reads its environment. Every value is checked whatever its length, so a short value refuses every argument that contains it.

**Redaction.** The command's stdout and stderr pass through a redactor that replaces each value, its `encodeURIComponent` form, and, for a URL value with a password of 8 characters or more, that password (as written, decoded and encoded) with `<NAME>`; an old value your shell exports for a declared or ambient name is replaced too, the local stack's public default excepted. Other forms (base64, JSON-escaped, shell-quoted) are not caught. Every declared value is redacted wherever it appears, whatever its length: a public one (`SUPABASE_URL`) or a short one is replaced in all of the command's output. That costs readable output, never a leak; marking a name as public is not built. Bytes no value covers pass through unchanged, so binary output (`pg_dump -Fc`, `tar`) is byte-identical, and a prompt without a newline shows at once. The cost: the command's stdout and stderr are pipes, not your terminal, so it prints no colour unless forced and opens no pager. Its stdin is your terminal, so a prompt it reads still works. `run` returns once the command has exited and its output has closed: a command that leaves a process running in the background with the same output keeps `run` waiting until that process closes it; redirect such a process's output inside the command.

**The command's own command line is the command's.** The check above sees the arguments `run` is given, not the ones the command later gives its own children. `-- sh -c 'psql "$DB_URL"'` passes it, since the argument is the text `$DB_URL`, yet the inner shell expands it, and psql then runs with the URL and its password on its command line for as long as it runs. Hand such a tool its credential through the environment instead. For psql, a wrapper that takes the password out of the URL and gives it to libpq as `PGPASSWORD`:

```js
// scripts/psql.mjs: psql against DB_URL, with no password on any command line
import { spawnSync } from 'node:child_process';

const { DB_URL, ...env } = process.env;
const url = new URL(DB_URL);
const password = decodeURIComponent(url.password);
url.password = '';
const { status } = spawnSync('psql', [url.href, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...env, PGPASSWORD: password },
});
process.exit(status ?? 1);
```

```
npx cookwright run dev -- node scripts/psql.mjs -c 'select 1'
```

cookwright does not split a URL into libpq's `PG*` names for you.

**The command's descendants.** "One child" is the process tree the command starts: everything it starts inherits its environment, values included, unless it clears them, as the wrapper above does for `DB_URL`.

## The age backend

`age` is the free path that works everywhere `age` and `age-keygen` run (`brew install age`, or your system's age package). A target's values live in `secrets/<target>.env.age`, armored text encrypted to every public key in `secrets/recipients.txt`; both files are committed. The identity that opens them is the one secret, and it lives outside every repo:

- at the path `COOKWRIGHT_AGE_IDENTITY` names, else `$XDG_CONFIG_HOME/cookwright/identity.age`, else `~/.config/cookwright/identity.age`;
- never inside a git work tree, judged by the real path of its directory and, once it exists, of the identity file itself (a `~/.config` symlinked into a dotfiles repo counts as inside it, and so does an `identity.age` linked into one, as GNU stow links files).

**`npx cookwright secrets init`** writes the identity and appends its public key to `secrets/recipients.txt`, creating the file on a fresh repo. It checks everything first, and writes nothing when a check fails: the identity's directory (and an existing identity's own real path) outside every work tree, git not ignoring `secrets/`, `secrets/recipients.txt` or a target's `.env.age` (a refusal names the `.gitignore` line to remove), the recipients file committed and well formed, both places writable. It then says what it will write and asks; `--yes` answers for you. age asks for the identity's passphrase on your terminal: type one. An empty one makes age generate a passphrase and print it on the terminal, once; keep it if you take it. The identity is written mode 600 in a directory created 700. `--no-passphrase` writes the key unprotected, which is weaker: whoever reads that file opens every secret. When an identity is already there, `init` writes none: it enrols this repo with it (see "One identity per developer" below).

**Adding a passphrase later.** An identity written with `--no-passphrase` gets one the way `init` writes a protected one: age encrypts it with a passphrase it asks for on your terminal, and a passphrase-encrypted file is an identity age reads. In the identity's directory:

```
age -p -o identity.age.new identity.age
chmod 600 identity.age.new
mv identity.age.new identity.age
```

Doctor's `secrets.backend` then reads the identity as passphrase-protected, and every `run` asks for the passphrase.

Commit `secrets/recipients.txt` before the first `set`: nothing is encrypted to a recipient that has not been through a commit.

**The recipients file.** `secrets/recipients.txt` lists the public keys (`age1…`) every ciphertext is encrypted to, one per line; blank lines and `#` comments are allowed. `secrets set` encrypts only to a recipients file that is committed and equal to your last commit, and prints each key's last eight characters, so a key added to the file has to go through a commit you can read before anything is encrypted to it. Any other line refuses; a secret key (`AGE-SECRET-KEY-…`) in the file refuses too, and doctor FAILs it: remove the line and treat that identity as exposed.

**A ciphertext you did not write.** An age ciphertext does not say who wrote it: anyone holding the public recipients file can write a valid `secrets/<target>.env.age`. A change to it that did not come from your own `secrets set` (a merge, a pull, someone else's branch) cannot be reviewed, since its diff is ciphertext. Don't keep it: take your own version and set the values again from where they come from. A proof catches a swapped value for a name it covers; an unproved name has no such check, which is the exposure. Signed ciphertext is not built.

**One identity per developer.** In a second repo on the same machine, run `npx cookwright secrets init` there too: it finds your identity, writes no new one, reads its public key (`age-keygen -y`; for a passphrase-protected identity, age asks for the passphrase on your terminal and the key is read in memory only) and appends it to that repo's `secrets/recipients.txt`, after the same checks and the same question; commit the file before the first `set`. When the file already holds that key, it writes nothing. On a second machine, copy your identity (passphrase-protected, outside any repo) to the same place instead of making a new one; `init` there then finds it the same way. `init` on a repo whose recipients file already holds a key says so before it asks. A new recipient cannot read what is already encrypted: each value has to be set again after the new key is committed.

**`npx cookwright secrets set <target> <NAME>`** asks for the value on the terminal with echo off and stores it in the target's ciphertext, replacing that name's line or adding it. The hidden prompt takes printable characters and backspace; a tab or any other control character (an arrow key sends one) refuses the value rather than store it altered, so a value holding a tab goes through `--stdin`. `--stdin` reads exactly one line from standard input instead (a script's path; two lines are refused). It never takes a value as an argument, and it prints the name, the target and the recipients' key endings, never the value. It refuses a name the target does not declare, and refuses before asking when `secrets/recipients.txt` is not committed, is staged for deletion, or differs from your last commit (`git diff HEAD -- secrets/recipients.txt` shows how). When the target already has a ciphertext, it is decrypted and checked first (age asks for a protected identity's passphrase then), so an identity that cannot open it, or contents that are not the declared lines, refuse before you type the value. A line of a name the target no longer declares (one you removed from `secrets.targets.<target>.names`) is the exception: `set` drops it from what it writes back and names it (`removed OLD_KEY from dev's values, no longer declared`). Until then `run` refuses the target, naming that line's number and the `secrets set` that drops it.

**A passphrase-protected identity and agents.** age asks for the passphrase on the terminal every time it opens the identity, for `run` and for `set` alike. Without a terminal (an agent's shell), `run` refuses before anything starts: `the identity is passphrase-protected; hand this command to the developer`.

## The 1Password backend

`1password` reads each value from an item in 1Password through its CLI, `op` (`brew install 1password-cli`, or the CLI's install guide). Nothing secret is in the repo: `secrets/<target>.env.tpl`, committed, names where each value lives, one reference per declared name:

```
# dev: the API project's items
API_URL=op://Dev/api/url
API_TOKEN=op://Dev/api/credentials/token
```

A line is `NAME=op://<vault>/<item>/<field>`, or `NAME=op://<vault>/<item>/<section>/<field>` for a field inside a section, each part made of letters, digits, spaces, `.`, `_` and `-`; or a blank line; or a `#` comment. Anything else is a literal, a value that would sit in the repo: `run` refuses it and doctor FAILs it, naming the line number and never printing the line. That includes a comment that looks like an assignment (`# API_TOKEN=…`), a quoted reference, a reference holding `$`, `{` or `}` (which `op` would fill in from your environment), and `{{ … }}` templating. Each declared name has exactly one reference, and the template references no other name.

`run` hands `op inject` the reference lines alone, on stdin, each reference inside `{{ }}` (written by `run`, not in the file), so `op` sees no comment and nothing else of the file and reads a vault or item name holding a space whole, and reads its answer back line by line against them: one line per reference, in order. A field whose value spans several lines is refused, as is any line that is not the next reference's. `op` runs with your environment minus the declared and ambient names; it keeps its own `OP_SERVICE_ACCOUNT_TOKEN`, `OP_CONNECT_HOST`, `OP_CONNECT_TOKEN` and `OP_SESSION_*`, which the command never receives (the banner names them as dropped).

`secrets set` and `secrets init` write nothing on this backend: you add and change the items in 1Password. Doctor checks the template only (present, committed, one reference per name, no literal), so `secrets.backend` reads `op on PATH`: whether you are signed in, and whether each reference resolves, is what `run` proves. A failed `op inject` refuses with `op`'s own first line and the sign-in hint.

## The keychain backend

`keychain` keeps each value in your default macOS keychain (normally the login keychain), through `security`, which ships with macOS. Nothing of it is in the repo. Each secret is a password item whose service is `cookwright/<id>/<target>` and whose account is the secret's name, so `secrets.id` is required with this backend: two repos never share an item, even with the same directory name. `run`'s banner and `secrets set` name the service. There is nothing to `init`.

**`npx cookwright secrets set <target> <NAME>`** asks for the value on the terminal with echo off (or reads one line with `--stdin`), as for `age`, and stores it. The value is on no command line: `security`'s own prompt cuts a value at 128 characters without a word, which a service-role key or a pooler URL exceeds, so cookwright writes the item through `security -i`, which reads its command from stdin, then reads the item back and compares it with what you typed. A value that does not come back whole is removed, and nothing is kept. `security -i` reads one command of at most 4096 bytes, so a value can be about 4000 bytes long (a `\` or `"` counts twice); a longer one is refused before anything is written. A value holding a non-ASCII character, or a tab given with `--stdin`, comes back as given: cookwright reads items with `find-generic-password -g`, which tells such a value from one made of hex digits.

`security` searches your default keychain list, so an item with the same service and account in another keychain on that list could be found first.

Doctor looks each declared name up by its service and account (`find-generic-password` without `-g` or `-w`, about 10 ms a name), never reading a value: `dev: present by name under cookwright/<id>/dev` is all it claims. Whether a value is the right one is what `run` proves.

## What doctor checks

Three rows, after every row a level requires (after `packs`, before a declared pack's own rows), so a slow keychain never costs a required row its time. No level requires them: they sit beside the levels until Level 2 opens. Doctor never prompts, never decrypts, never resolves a reference and never reads a value; each line names secrets, files and line numbers, and claims only what it measured.

**`secrets.backend`**: the backend can run here.

- No `secrets` key: PASS `no backend (Level 2 off)`.
- A tool an operation needs is not on PATH (`age`, `op`, `security`): SKIP naming it, its install line and the command that uses it. `age-keygen` counts only while there is no identity yet, since only `secrets init` uses it. The keychain backend off macOS: SKIP.
- `age`: FAIL when the identity's directory, or the identity file itself, is inside a git work tree (by real path, so a `~/.config` symlinked into a dotfiles repo counts, and so does an identity file linked into one); WARN `identity missing` (`secrets init` writes it, or copy yours from another machine); FAIL when group or others can read it (`chmod 600`); WARN when it has no passphrase, judged by its first bytes, never quoting them; PASS when it is passphrase-protected and yours alone. On Windows the permissions are not measured, so a protected identity reads SKIP rather than PASS.
- `1password`: PASS `op on PATH`. Whether you are signed in is not this row's claim: `run` proves it.
- `keychain`: PASS naming the service of each target.

**`secrets.targets`**: each target's state, one part per target, joined by `; `.

- No `secrets` key: PASS `no targets declared`. An empty `targets`: WARN, a state you chose mid-setup.
- When `secrets.backend` is SKIP or FAIL, this row is SKIP with its reason: nothing is inspected through a backend that cannot run.
- Any of `secrets/`, the recipients file or a target's file ignored by git: FAIL naming the `.gitignore` line to remove (the directory alone when it is the one ignored).
- `age`: `dev: ciphertext and recipients tracked` when `secrets/dev.env.age` is committed and equal to HEAD and so is `secrets/recipients.txt`. The names inside are not checked, since that would mean decrypting: a missing name surfaces at `run`. A target with no ciphertext, or one that is uncommitted or differs from HEAD, WARNs; so does a recipients file that differs from HEAD, and a secret key in it FAILs.
- `1password`: the template present, committed, one reference per declared name; a literal line FAILs by number.
- `keychain`: each declared name present by its service and account; a missing one WARNs naming the `secrets set` to run.
- A target without a proof WARNs `unproved`.
- When doctor's time budget runs out inside an inspection, the row is SKIP (`unverified: …`), never a PASS on part of the targets.

**`secrets.carriers`**: the places that carry a secret into every process, by name only.

- An `.envrc` at the work tree's top or in any directory down to the config root, tracked or not, or tracked anywhere under the config root: direnv exports it into every command below it. The row names each from the top, so a nested config's parent `.envrc` counts.
- A declared name, or a name the declared packs' tools read on their own (`SUPABASE_DB_URL`, `PGPASSWORD`, …), exported in the environment doctor runs in.
- A line setting such a name in `~/.zshenv`, `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile` or `~/.profile`, comments skipped, `export NAME=…` and `NAME=$(op read …)` alike: the row names the line's file, not its value.
- Each is a WARN. With no `secrets` key, only `.envrc` and the packs' names are looked for.

## What the agent is told

The managed block that `npx cookwright init` writes into `AGENTS.md` (version 4 of it) gives the agent these rules in its Secrets section, beside the two it always had (no plaintext env file; a secret is named, never written down):

- a command that needs a credential runs through `npx cookwright run <target> -- <command…>`, and only with a target you named in the session;
- with a passphrase-protected age identity, the agent hands you the `run` command instead of running it, since age asks you for the passphrase;
- never `export` a secret, never pass one as an argument, never print a process's command line or environment;
- never read a value from the backend itself (`age -d`, `op read`, `op inject`, `security find-generic-password -w`) and never open the identity file: a refusal's own line names the fix;
- `secrets init` and `secrets set` are yours: the agent hands them over, never runs them, and never asks you for a value in the transcript.

An older block reads stale in doctor's `rules.block` until `npx cookwright init` refreshes it.

## What is not closed

- **The command's environment.** The values sit in the environment of the command `run` starts, for as long as it runs, as any injected variable does. Another process running as you, or as root, can read a process's environment (`/proc/<pid>/environ` on Linux, `ps eww <pid>` where `ps` prints environments). cookwright narrows this to one command for one run; it does not close it.
- **cookwright's own process.** It holds the target's values in memory until the command starts. Its own environment is the one your shell gave it: a stale export of a declared name is still in it (and in your shell). `run` keeps it from the command and names it on the banner; `secrets.carriers` names where it comes from.
- **What the command does with a value.** The command's own command line and its children's (above), a file it writes, a request it sends, a log line in a form the redactor does not know (base64, JSON-escaped, shell-quoted): these are the command's.
- **An identity without a passphrase.** Whoever reads that file opens every ciphertext encrypted to it.
- **A recipient added after a ciphertext was written** cannot read it until each value is set again; there is no `secrets rekey`.

## Moving an existing app off its `.env`

1. Write down the names your `.env` holds, not the values (`cut -d= -f1 .env` prints the names alone; never paste the file into a transcript). Values that go to the shipped app (`EXPO_PUBLIC_…` in an Expo app) are compiled into it and readable by anyone who has it: they are public by design, not secrets, so they belong in committed config (a build profile's `env` in `eas.json`, for instance), not in a target.
2. Choose a backend and declare a target per environment with those names and its proof (Setting up, above).
3. Set each value: `npx cookwright secrets set dev DB_URL`, pasting it at the hidden prompt from where it comes from (the dashboard, your password manager), or, for a plain unquoted line, straight from the file without it touching a command line or the screen: `grep '^DB_URL=' .env | cut -d= -f2- | npx cookwright secrets set dev DB_URL --stdin`.
4. Stop loading the file: remove the `dotenv` import or the `--env-file` flag, and run the commands that need a credential through `run`: `npx cookwright run dev -- npm run seed`.
5. Delete `.env`. If it was ever committed, untracking it is not enough: the values are in git's history, so rotate each one at its source.
6. Remove any `export NAME=…` of those names from your shell's rc files, then run doctor: `secrets.env` and `secrets.carriers` read PASS when nothing is left.

## Updating to version 4

`npx cookwright migrate` writes an older `cookwright.json` at version 4. The step changes nothing but the version: it never writes a `secrets` key.

```
3 → 4: no secrets backend declared, Level 2 off (the secrets guide shows the key)
```

A `secrets` key already in a version 3 file is kept (`3 → 4: secrets kept as it is`) and then validated like any other.
