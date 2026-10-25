# Hooks and escapes

init writes two shims, `.githooks/pre-commit` and `.githooks/pre-push`, and sets `core.hooksPath` to `.githooks` in the repo's local git config. The shims hold no logic: they call `cookwright hook` in the installed package, so a fix reaches you with a version bump. Without node, or with the package not installed, a shim prints one line and lets the commit or push through; doctor reads a hook whose package is not installed where it runs as weak, since it checks nothing.

`npx cookwright hook <pre-commit|pre-push>` is what the git hooks call; you rarely run it by hand.

## pre-commit

pre-commit scans the staged diff for secrets with gitleaks (`brew install gitleaks`; skipped with a line when it is not installed; values are redacted in the output) and checks the doc-sync rules in `cookwright.json` (`hooks.docSync`): each rule names code pathspecs and the docs that must be staged with them, and git's own pathspec matching applies (`:!*.test.mjs` excludes). One staged doc of a rule's list satisfies it.

```json
"hooks": {
  "docSync": [
    { "name": "api", "code": ["src/api/*"], "docs": ["docs/api.md"] }
  ]
}
```

A commit of `src/api/a.ts` without `docs/api.md` (output from cookwright 0.1.0, 2026-10-22; gitleaks's `INF` lines left out):

```
pre-commit  PASS  secrets  staged diff clean (gitleaks 8.30.1)
pre-commit  FAIL  doc-sync  api: 1 file(s) changed (src/api/a.ts), but none of docs/api.md is staged; update the doc in this commit, or COOKWRIGHT_SKIP=doc-sync with the reason in the message
```

## pre-push

pre-push runs the `gate.checks` suite, the same one the bundle gate runs, with its elapsed time on the line, and checks that `CHANGELOG.md` matches the release tags (see [Releases and the changelog](releases-and-changelog.md)). It judges the working tree, so it runs only when that is a pushed commit: both checks are skipped, naming why, when the tree has uncommitted files or when no pushed ref is the checked-out commit. An annotated tag on that commit counts as it, so the release push checks the changelog. When the checked-out commit is pushed with other refs, the checks run and each line names the refs it tested and the ones it did not.

## Escapes

`COOKWRIGHT_SKIP=doc-sync git commit …` skips the named checks (comma-separated: `secrets`, `doc-sync`, `gate`, `changelog`) and says so; since the escape leaves no trace, put the reason in the commit message:

```
pre-commit  PASS  secrets  staged diff clean (gitleaks 8.30.1)
pre-commit  SKIP  doc-sync  skipped by COOKWRIGHT_SKIP; say why in the commit message
```

`git commit --no-verify` skips everything and is the last resort.

## Merge commits

A clean `git merge` runs no pre-commit. A `--no-commit` merge or a conflict resolution does, and its staged diff is the whole merged side, so a doc-sync rule can fail for commits that each passed on their own; the escape with the reason is the answer.

## Hooks managed elsewhere

With husky, lefthook, a hook in `.git/hooks`, a global `core.hooksPath`, or a `.githooks` file of your own that does not call cookwright, init installs nothing and says why, and doctor reads `hooks.path`, `hooks.pre-commit` and `hooks.pre-push` as weak (WARN), not missing: a setup you chose, so the level can still read complete. Appending the cookwright call into those hooks is backlog item E-018. Your own hook may call `node node_modules/cookwright/bin/cookwright.mjs hook pre-commit "$@"` itself, as its last line, with `exec`, or followed by `|| exit 1`, and init and doctor count it.

## Older git

init and doctor read where `core.hooksPath` is set with `git config --show-scope`, which git 2.26 added. On an older git they tell only the local config from the rest (`not the local config`); nothing else changes.

## Linked worktrees

Linked worktrees share `core.hooksPath`, so a worktree whose branch has no `.githooks/` runs no hook; doctor there reports the shims missing, and init there writes them on that branch.

## A config below the top

An app in a monorepo, with `cookwright.json` below the work tree's top, gets its shims at the top: see [Monorepos and CLAUDE.md](monorepos-and-claude-md.md).
