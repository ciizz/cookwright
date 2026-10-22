# Releases and the changelog

`CHANGELOG.md` is generated from git, never written by hand. A commit's subject is what reaches it, in the conventional form `type(scope)!: text`: `feat`, `fix` and `perf` are listed under Features, Fixes and Performance, `!` marks a breaking change, and every other type (`docs`, `chore`, `refactor`, `test`, …) is counted as internal.

## The command

`npx cookwright changelog [--check | --unreleased | --adopt]` generates the changelog from the release tags (`vX.Y.Z`) and the conventional commit subjects between them: `feat`, `fix` and `perf` are listed, the rest counted as internal, and a release's date and notes come from its annotated tag body (`released: YYYY-MM-DD`, `note: …`). It is never edited by hand. `--check` exits 1 when the file is missing, not generated or out of date, and a refusal (a git failure, a file it cannot read or write) exits 2; `--unreleased` prints what no release tag holds yet. A changelog it did not generate is replaced only with `--adopt`, so keep a copy of what you want from it.

On a repo with no release tag yet and one `feat` commit among three (cookwright 0.1.0, 2026-10-22):

```
$ npx cookwright changelog --unreleased
## Unreleased — 3 commits, no release tag yet

### Features

- offline mode `fee73542`

_2 internal (docs, chore, refactor, tests, tooling)._

$ npx cookwright changelog --check
CHANGELOG.md: up to date (0 release tag(s))
```

## Releasing

To release, in this order:

```bash
npm version 1.2.0 --no-git-tag-version
git commit -m 'chore: release 1.2.0' package.json package-lock.json
git tag -a v1.2.0 -m 'released: 2026-10-15' -m 'note: The first release with offline mode.'
npx cookwright changelog
git commit -m 'docs: changelog for v1.2.0' CHANGELOG.md
git push --follow-tags
npm publish
```

The version bump is its own commit, so the tag sits on it; the changelog is generated after the tag, from it, and committed on top. `git push --follow-tags` runs pre-push, the gate and the changelog check, which passes only once the changelog matches the new tag. `npm publish` is last, for a package that is published at all.

## Tag bodies

The tag body is `key: value` lines: `released` dates the heading, `note` becomes a quote, any other key renders as a labelled line. A lightweight tag has no body, so its section has no date. Until the changelog is regenerated after a tag, `--check` and the pre-push changelog check fail, which is the reminder.

## Adopting the generator

To adopt the generator on an existing hand-kept changelog, run `npx cookwright changelog --adopt` once: it replaces the file, and anything not derivable from the tags and the commit subjects is lost, so keep a copy of what you want.
