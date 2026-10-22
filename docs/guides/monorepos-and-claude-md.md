# Monorepos and CLAUDE.md

## A config below the top

An app in a monorepo has `cookwright.json` in `apps/mobile/`, not at the work tree's top. init writes the git shims at the work tree's top, where git looks, and each shim enters `apps/mobile` before calling cookwright, which is installed there. The secret scan still runs at the top, over the whole staged diff, with the top's `.gitleaks.toml`, as doctor's dry run does. Your own hook does the same with `cd apps/mobile && ` before the call (see [Hooks managed elsewhere](hooks-and-escapes.md#hooks-managed-elsewhere)).

Codex's session-start hook enters the work tree's top, so it gives no readout at all when `cookwright.json` sits below it: doctor's Codex `host.hook` reads weak there, and doctor is run by hand from the config root (backlog item B-002; see [Codex](codex.md#the-hook-judges-from-the-top)).

## Already have a CLAUDE.md?

Rules live in one `AGENTS.md`. Move your `CLAUDE.md`'s rules into `AGENTS.md` and leave `CLAUDE.md` as the single line `@AGENTS.md`. Every host then reads one rules file. If you leave `CLAUDE.md` as it is, init prepends that import line to it. A `CLAUDE.md` that is a symlink to `AGENTS.md` already works and is left alone; init refuses to write through any other symlink, including a linked directory on the way to a file it writes (a `.claude` or `docs` that points elsewhere).

Without a root `CLAUDE.md`, init writes one, the import line alone, only when Claude Code would otherwise not read `AGENTS.md`: a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in or above the repo shadows it, or the installed Claude Code is older than 2.1.281. Otherwise init reports `skipped CLAUDE.md` and doctor's `host.rules` says why it is not needed.
