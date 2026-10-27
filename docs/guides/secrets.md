# Secrets

A secret never touches disk in plaintext, and no env file stands in for one, not even as a fallback. cookwright reads a target's secrets from a backend and injects them into one child process, after checking that the values name the target you asked for (its proof). With no backend declared, Level 2 is off and nothing here applies.

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

**A value on the command line is refused.** `-- psql "$DB_URL"` is expanded by your shell before cookwright starts, so the URL would sit on psql's command line, where any process listing shows it, and if your shell still exports an old `DB_URL`, it would be that one, under the dev banner. `run` refuses an argument that holds a target's value (or its URL-encoded form, or a URL's password), or the value of a declared or ambient name your shell still exports (8 characters or more), and any `scheme://user:password@host` argument, naming its position, never the argument: `argument 2 holds the value of DB_URL; read it from the environment inside the command instead`. A URL with a password whose host is `localhost`, `127.x.x.x`, `::1` or `host.docker.internal` (the local Supabase stack's `postgres:postgres`) passes that shape check. Write the command so it reads the variable itself: a script, an npm script, or a program that reads its environment. Every value is checked whatever its length, so a short value refuses every argument that contains it.

**Redaction.** The command's stdout and stderr pass through a redactor that replaces each value, its `encodeURIComponent` form, and, for a URL value with a password of 8 characters or more, that password (as written, decoded and encoded) with `<NAME>`; an old value your shell exports for a declared or ambient name is replaced too. Other forms (base64, JSON-escaped, shell-quoted) are not caught. Bytes no value covers pass through unchanged, so binary output (`pg_dump -Fc`, `tar`) is byte-identical, and a prompt without a newline shows at once. The cost: the command's stdout and stderr are pipes, not your terminal, so it prints no colour unless forced and opens no pager. Its stdin is your terminal, so a prompt it reads still works. `run` returns once the command has exited and its output has closed: a command that leaves a process running in the background with the same output keeps `run` waiting until that process closes it; redirect such a process's output inside the command.

## The age backend

`age` is the free path that works everywhere `age` and `age-keygen` run (`brew install age`, or your system's age package). A target's values live in `secrets/<target>.env.age`, armored text encrypted to every public key in `secrets/recipients.txt`; both files are committed. The identity that opens them is the one secret, and it lives outside every repo:

- at the path `COOKWRIGHT_AGE_IDENTITY` names, else `$XDG_CONFIG_HOME/cookwright/identity.age`, else `~/.config/cookwright/identity.age`;
- never inside a git work tree, judged by the real path of its directory (a `~/.config` symlinked into a dotfiles repo counts as inside it).

**`npx cookwright secrets init`** writes the identity and appends its public key to `secrets/recipients.txt`, creating the file on a fresh repo. It checks everything first, and writes nothing when a check fails: no identity there yet, its directory outside every work tree, git not ignoring `secrets/`, `secrets/recipients.txt` or a target's `.env.age` (a refusal names the `.gitignore` line to remove), the recipients file committed and well formed, both places writable. It then says what it will write and asks; `--yes` answers for you. age asks for the identity's passphrase on your terminal: type one. An empty one makes age generate a passphrase and print it on the terminal, once; keep it if you take it. The identity is written mode 600 in a directory created 700. `--no-passphrase` writes the key unprotected, which is weaker: whoever reads that file opens every secret.

Commit `secrets/recipients.txt` before the first `set`: nothing is encrypted to a recipient that has not been through a commit.

**One identity per developer.** On a second machine, copy your identity (passphrase-protected, outside any repo) to the same place instead of running `init`. `init` on a repo whose recipients file already holds a key says so before it asks. A new recipient cannot read what is already encrypted: each value has to be set again after the new key is committed.

**`npx cookwright secrets set <target> <NAME>`** asks for the value on the terminal with echo off and stores it in the target's ciphertext, replacing that name's line or adding it. `--stdin` reads exactly one line from standard input instead (a script's path; two lines are refused). It never takes a value as an argument, and it prints the name, the target and the recipients' key endings, never the value. It refuses a name the target does not declare, and refuses before asking when `secrets/recipients.txt` is not committed, is staged for deletion, or differs from your last commit (`git diff HEAD -- secrets/recipients.txt` shows how).

**A passphrase-protected identity and agents.** age asks for the passphrase on the terminal every time it opens the identity, for `run` and for `set` alike. Without a terminal (an agent's shell), `run` refuses before anything starts: `the identity is passphrase-protected; hand this command to the developer`.

## The 1Password backend

`1password` reads each value from an item in 1Password through its CLI, `op` (`brew install 1password-cli`, or the CLI's install guide). Nothing secret is in the repo: `secrets/<target>.env.tpl`, committed, names where each value lives, one reference per declared name:

```
# dev: the API project's items
API_URL=op://Dev/api/url
API_TOKEN=op://Dev/api/credentials/token
```

A line is `NAME=op://<vault>/<item>/<field>`, or `NAME=op://<vault>/<item>/<section>/<field>` for a field inside a section, each part made of letters, digits, spaces, `.`, `_` and `-`; or a blank line; or a `#` comment. Anything else is a literal, a value that would sit in the repo: `run` refuses it and doctor FAILs it, naming the line number and never printing the line. That includes a comment that looks like an assignment (`# API_TOKEN=…`), a quoted reference, a reference holding `$`, `{` or `}` (which `op` would fill in from your environment), and `{{ … }}` templating. Each declared name has exactly one reference, and the template references no other name.

`run` hands `op inject` the reference lines alone, on stdin, so `op` sees no comment and nothing else of the file, and reads its answer back line by line against them: one line per reference, in order. A field whose value spans several lines is refused, as is any line that is not the next reference's. `op` runs with your environment minus the declared and ambient names; it keeps its own `OP_SERVICE_ACCOUNT_TOKEN`, `OP_CONNECT_HOST`, `OP_CONNECT_TOKEN` and `OP_SESSION_*`, which the command never receives (the banner names them as dropped).

`secrets set` and `secrets init` write nothing on this backend: you add and change the items in 1Password. Doctor checks the template only (present, committed, one reference per name, no literal), so `secrets.backend` reads `op on PATH`: whether you are signed in, and whether each reference resolves, is what `run` proves. A failed `op inject` refuses with `op`'s own first line and the sign-in hint.

## The keychain backend

`keychain` keeps each value in your default macOS keychain (normally the login keychain), through `security`, which ships with macOS. Nothing of it is in the repo. Each secret is a password item whose service is `cookwright/<id>/<target>` and whose account is the secret's name, so `secrets.id` is required with this backend: two repos never share an item, even with the same directory name. `run`'s banner and `secrets set` name the service. There is nothing to `init`.

**`npx cookwright secrets set <target> <NAME>`** asks for the value on the terminal with echo off (or reads one line with `--stdin`), as for `age`, and stores it. The value is on no command line: `security`'s own prompt cuts a value at 128 characters without a word, which a service-role key or a pooler URL exceeds, so cookwright writes the item through `security -i`, which reads its command from stdin, then reads the item back and compares it with what you typed. A value that does not come back whole is removed, and nothing is kept. `security -i` reads one command of at most 4096 bytes, so a value can be about 4000 bytes long (a `\` or `"` counts twice); a longer one is refused before anything is written. A value read back holding a tab or a non-ASCII character comes back as typed: cookwright reads items with `find-generic-password -g`, which tells such a value from one made of hex digits.

`security` searches your default keychain list, so an item with the same service and account in another keychain on that list could be found first.

Doctor looks each declared name up by its service and account (`find-generic-password` without `-g` or `-w`, about 10 ms a name), never reading a value: `dev: present by name under cookwright/<id>/dev` is all it claims. Whether a value is the right one is what `run` proves.

## Updating to version 4

`npx cookwright migrate` writes an older `cookwright.json` at version 4. The step changes nothing but the version: it never writes a `secrets` key.

```
3 → 4: no secrets backend declared, Level 2 off (the secrets guide shows the key)
```

A `secrets` key already in a version 3 file is kept (`3 → 4: secrets kept as it is`) and then validated like any other.
