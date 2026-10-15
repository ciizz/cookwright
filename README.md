# cookwright

A guided, incremental, non-rotting agentic harness for solo developers building mobile apps with React Native, TypeScript and Supabase.

Not yet usable. See `CHARTER.md` for what it will be and `docs/dev/` for how it is being built.

What exists today: the bundle runner (`packages/cookwright/src/bundle.mjs`), configured by `cookwright.json` at the repo root, with its Claude Code adapter under `hosts/claude/`. The procedure is `docs/playbook.md`. This repo runs its own bundles through it.

```bash
npm ci && npm test
node packages/cookwright/src/bundle.mjs status
```

MIT.
