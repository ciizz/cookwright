# Codex

## Setting it up

With `codex` in `hosts` (`npx cookwright init --hosts codex` on a fresh repo, `--hosts claude,codex` for both hosts, or the key edited in `cookwright.json` and init rerun), init writes `.agents/skills/setup` (Codex has no workflows, so no `bundle` and no `docs-audit`) and the session-start hook in `.codex/hooks.json`.

## Trusting the hook

Codex runs a project hook only once you trust it with `/hooks`, and again after every rewrite of that file, which init keeps as rare as it can. Codex reads the file only at startup, so a Codex already open when init first writes it lists no hook to trust (`/hooks` shows SessionStart installed 0). After the first write and after every rewrite alike, restart Codex at the work tree's top, trust the hook with `/hooks`, and the readout comes in the next new session.

Doctor's Codex `host.hook` says that the file carries the hook and leaves the trust to you (restart Codex, then `/hooks`), since trust is not readable from outside Codex.

## What was measured

Measured on 2026-10-18 with Codex 0.163.0, interactive only: after `/hooks` trust, a new session's agent received the doctor readout from the hook, and `$setup` was listed through the pointer. Under `codex exec`, measured on 2026-10-16 with Codex 0.145.0 (3 runs), no project hook fired.

## The matcher

The hook runs on `startup|resume`; a copy of it under another matcher (`compact`, say) reads as weak, and init moves or removes it.

## The hook judges from the top

The hook enters the work tree's top before running doctor, so its readout judges from there: an `AGENTS.override.md` in a subdirectory the session started in is caught by `npx cookwright doctor` run by hand in that directory, not by the hook line. For the same reason the hook gives no readout at all when `cookwright.json` sits below the top (`apps/mobile/` in a monorepo): doctor's Codex `host.hook` reads weak there, and doctor is run by hand from the config root (backlog item B-002; see [Monorepos and CLAUDE.md](monorepos-and-claude-md.md)).
