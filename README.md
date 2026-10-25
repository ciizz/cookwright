# cookwright

cookwright is an open-source harness that keeps AI-assisted development disciplined and verifiable. It installs the safeguards (git hooks, a session-start doctor, generated state) and tells you the moment your process drifts. Built for solo developers, with stack packs for Expo and Supabase; secure credential handling is on the way.

## What you get

- **A doctor at every session start.** A session-start hook runs 19 checks, plus four for each stack pack you declare (five for Supabase), and puts the readout in your agent's context; each line that is not PASS names its next step.
- **Git hooks that catch mistakes.** Before each commit, they stop a secret from going in, and stop a code change that leaves out the doc you tied it to. Before each push, they run your tests. If a tool they need isn't installed, they say so and let you through.
- **Standards for your stack, each one measured.** The `expo` and `supabase` packs put each engineering rule in your `AGENTS.md` beside the check that measures it: no literal UI string, no raw colour or spacing in a component, short functions, the Supabase client from one place, the contract docs moved with the code. A commit fails only when it adds a violation, so an existing app's backlog never blocks it; a push fails when the branch made the count rise. See [Standards](docs/guides/standards.md).
- **A changelog you never write.** It is generated from release tags and conventional commit subjects, and checked on every push.
- **A setup skill.** `/setup` walks doctor's readout one remedy at a time and stops at the decisions that are yours.

## Why it exists

cookwright grew out of the harness built over a year for Leeka, a live React Native app in both stores. The agent planned before it coded, reviewed before it merged and kept the docs true only where the harness made it, and every rule that held was one a hook or a check enforced. That harness lived in one repo, hand-maintained. cookwright makes it something a stranger can install, and an update can reach.

## Is it for you

It is for a solo developer who works with Claude Code or Codex and merges locally. It is not for you yet if you are a team with PR review, on Windows, or on yarn Plug'n'Play.

## Quick start

In your app's git repo:

```bash
npm install --save-dev cookwright
npx cookwright init
```

```
wrote    cookwright.json                    baseBranch main; packs: none detected; gate: npm test
wrote    AGENTS.md                          written with the managed rules block
wrote    .claude/settings.json              SessionStart hook runs doctor
wrote    .githooks/pre-commit               the managed shim, executable; it calls the hook in the package
…                                           (16 steps, every file named, then doctor's 19 lines)
19 checks — 19 PASS, 0 FAIL, 0 WARN, 0 SKIP
level 0 declared: complete
```

On an Expo app, run `npx expo lint` first and add `eslint-plugin-i18next` to the install, so init can wire the packs it detects ([Getting started](docs/guides/getting-started.md#an-expo-app-the-stack-packs)). Commit the files init names, by path. From then on every session opens with `cookwright doctor: level 0 complete` in the agent's context, or with the checks that are not PASS; for those, run `/setup` (`$setup` in Codex). The full walkthrough, with every command's output, is [Getting started](docs/guides/getting-started.md).

## How it works

No script is copied into your repo: it holds `cookwright.json`, thin git shims and symbolic links into `node_modules/cookwright`, so an `npm install` of a new version changes the behaviour without touching your tree. init also writes text that is not a script: the managed blocks of `AGENTS.md`, which it refreshes, and with a stack pack a starter contract doc (`docs/design-system.md`, `docs/data-model.md`) when absent, which is yours from then on and never rewritten. Doctor is the state: it reads the repo every time and stores nothing. The hooks call the package, judge only your change, and print one line and let you through when cookwright itself is missing or broken. Every kind of state has one home (`AGENTS.md` for rules, a backlog, closeouts, a generated changelog), named in a managed block of `AGENTS.md` that your agent reads. An update is a version bump, then the `migrate` or `init` that doctor names.

## Guides

- [Getting started](docs/guides/getting-started.md): install, init, the first commit and doctor, with real output; skills and workflows.
- [Hooks and escapes](docs/guides/hooks-and-escapes.md): what pre-commit and pre-push check, doc-sync rules, the standards check, `COOKWRIGHT_SKIP`, hooks managed elsewhere.
- [Standards](docs/guides/standards.md): the stack packs, each rule and what measures it, the ratchet, the contract docs and their audit, switching a rule off.
- [Releases and the changelog](docs/guides/releases-and-changelog.md): conventional subjects, tag bodies, the release order.
- [Updating](docs/guides/updating.md): a new version, `migrate`, refreshing the rules block and pointers, adding a pack to an existing repo.
- [Codex](docs/guides/codex.md): the hook, trusting it with `/hooks`, what was measured.
- [Monorepos and CLAUDE.md](docs/guides/monorepos-and-claude-md.md): a config below the top, an existing `CLAUDE.md`.

## Status

| Piece | State |
|---|---|
| Level 0: hooks, state homes, backlog, changelog, doctor, setup | works; 0.1.0 on npm |
| Stack packs: `expo`, `supabase` | works; not in 0.1.0 |
| Level 2: docs-audit skill | experimental; not in 0.1.0 |
| Level 1: screenshot atlas, SQL test suites | not available yet |
| Level 2: bundle runner | experimental |
| Level 2: secrets backends, Supabase ops, OTA preflight | not available yet |
| Claude Code | supported |
| Codex | supported interactively, once the hook is trusted; a Codex-only repo has no bundles |
| Windows, yarn Plug'n'Play, a global install | not supported |

## Why this repo carries its own cookwright state

cookwright is built with cookwright. init has been run on this repo, so its `AGENTS.md`, git hooks, backlog, closeouts and bundle state are the product applied to itself, and from stage 1 on its pieces ship as bundles through its own runner. That is why `docs/dev/` is here: it is this repo's state, not documentation you need to use cookwright. [CONTRIBUTING.md](CONTRIBUTING.md) maps it. [CHARTER.md](CHARTER.md) says what cookwright will be.

MIT.
