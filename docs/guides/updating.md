# Updating

Scripts are imported from the package, never copied into your repo, so an update is a version bump plus whatever doctor says the new version changed.

1. `npm install cookwright@latest`
2. Run `npx cookwright doctor` (or open a session): it says what the new version changed.
   - `config` weak means your `cookwright.json` loads only by migrating in memory: `npx cookwright migrate` writes it.
   - `rules.block` stale or `host.pointers` missing means the package ships a newer rules block or a new skill: `npx cookwright init` refreshes them and leaves your own text alone.
   - The `setup` skill walks the same readout, but only once init has written its pointer: on a repo set up before the skill shipped (`host.pointers` names `.claude/skills/setup` missing), run `npx cookwright init` yourself first, then `/setup` (`$setup` in Codex), in a new session if the host does not list it yet.
3. `git add` the paths migrate and init name, never `-A`, and commit.

## migrate

`npx cookwright migrate [--dry-run]` writes `cookwright.json` at the current format version. An older file already loads, migrated in memory, and doctor reads its `config` check as weak until you run this; each step prints one line, the file keeps its indent and line endings, and `--dry-run` prints the steps and writes nothing. On a file already current (cookwright 0.1.0, 2026-10-22):

```
$ npx cookwright migrate --dry-run
cookwright.json: already at version 2
```
