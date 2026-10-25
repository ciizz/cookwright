# Updating

Scripts are imported from the package, never copied into your repo, so an update is a version bump plus whatever doctor says the new version changed.

1. `npm install cookwright@latest`
2. Run `npx cookwright doctor` (or open a session): it says what the new version changed.
   - `config` weak means your `cookwright.json` loads only by migrating in memory: `npx cookwright migrate` writes it.
   - `rules.block` stale or `host.pointers` missing means the package ships a newer rules block or a new skill: `npx cookwright init` refreshes them and leaves your own text alone.
   - The `setup` skill walks the same readout, but only once init has written its pointer: on a repo set up before the skill shipped (`host.pointers` names `.claude/skills/setup` missing), run `npx cookwright init` yourself first, then `/setup` (`$setup` in Codex), in a new session if the host does not list it yet.
   - A pack row WARN (`pack.<name>.lint`, `pack.<name>.docs`, `pack.supabase.types`) names what the pack needs that your repo lacks; `/setup` walks them with consent.
3. `git add` the paths migrate and init name, never `-A`, and commit.

## migrate

`npx cookwright migrate [--dry-run]` writes `cookwright.json` at the current format version. An older file already loads, migrated in memory, and doctor reads its `config` check as weak until you run this; each step prints one line, the file keeps its indent and line endings, and `--dry-run` prints the steps and writes nothing. On a file already current (the harness fixture, 2026-10-25):

```
$ npx cookwright migrate
cookwright.json: already at version 3
```

## Version 3: the stack packs

Format version 3 adds `packs`, the stack packs the repo declares. Migrating a version 2 file writes `packs: []` and declares no pack (cookwright's own repo, 2026-10-25):

```
$ npx cookwright migrate --dry-run
2 → 3: packs added, empty (no stack pack declared; the setup skill offers the ones your tree shows)
dry run: cookwright.json would be written at version 3 (the file is rewritten in standard JSON layout, its indent kept); nothing written
```

It declares none even on an app the packs fit: init never edits an existing `cookwright.json` either, and a pack changes what a commit is held to, so it is yours to add. Doctor's `packs` row then WARNs the stack the tree shows (`expo detected (package.json depends on expo), no pack declared; the setup skill offers it`). `/setup` adds the names to `packs` with your consent and runs `npx cookwright init`, which writes each pack's section of `AGENTS.md`, its contract doc and, when `eslint.config.js` is Expo's template, its line there; the pack's doc-sync rules and gate checks, which init writes only into a fresh config, come from `npx cookwright packs rules` and the skill writes them in with consent. See [Standards](standards.md).
