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

**`host`**, in the core: `{ "kind": "host", "host": "api.example.com", "names": ["API_URL"] }`. `names` is required. Each covered value must be a URL whose host is `host`, both read the way `new URL` reads a host: case does not matter, a trailing dot is dropped, an IDN compares by its punycode, and https's default port 443 is dropped. Any other port is part of the host, so a database URL on `db.example.com:5432` needs `"host": "db.example.com:5432"`. `host` is a bare host: no scheme, path or user.

**`supabase`**, from the supabase pack (declare it in `packs`): `{ "kind": "supabase", "ref": "<project ref>" }`. `ref` is the 20 lowercase letters in your project's dashboard URL. Without `names`, the proof covers whichever of `SUPABASE_URL` and `DB_URL` the target declares, and is invalid when it declares neither. A covered value passes when it is:

- a project URL, `https://<ref>.supabase.co`;
- a database URL naming the ref as the pooler user `<role>.<ref>` (`postgres.<ref>`) on a host ending in `.pooler.supabase.com`, or as the direct host `db.<ref>.supabase.co`. When a URL has both a `<role>.<x>` user and a `db.<y>.supabase.co` host, x and y must both be the ref.

The ref anywhere else (the password, the path, the database name, the query string, a longer user name) proves nothing. The user part ends at the last `@` and is read by hand, not by `new URL`. A refusal names the secret, the expected ref and the anchor that failed. It names a ref it found only when the value has a `*.supabase.co` host, and never prints a value, a host or a password.

**The query-string rule, for both kinds.** A `postgres://` or `postgresql://` value is a mismatch when its query string sets a parameter that libpq lets override the URL's own host, user or credentials: `host`, `hostaddr`, `user`, `port`, `dbname`, `service`, `options`, `password` or `passfile`. Names are percent-decoded first, as libpq decodes them, so `?pass%77ord=` counts as `password`. `sslmode` and `application_name` pass. A user part holding an unencoded `/`, `?`, `#` or `@` is a mismatch too: libpq and a last-`@` reading would disagree on where the host starts. Percent-encode such a character in a password (`%40` for `@`).

## Updating to version 4

`npx cookwright migrate` writes an older `cookwright.json` at version 4. The step changes nothing but the version: it never writes a `secrets` key.

```
3 → 4: no secrets backend declared, Level 2 off (the secrets guide shows the key)
```

A `secrets` key already in a version 3 file is kept (`3 → 4: secrets kept as it is`) and then validated like any other.
