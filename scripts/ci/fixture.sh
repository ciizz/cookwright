#!/usr/bin/env bash
# The harness fixture (E-014): a real create-expo-app scaffold, the committed
# overlay appended, then the package's published shape (an npm pack tarball)
# installed and init, doctor, the hooks, changelog and migrate run against it.
# Runs locally and in CI: bash scripts/ci/fixture.sh. KEEP=1 keeps the temp dir;
# FIXTURE_STRICT=1 turns a missing tool from a skip into a failure.
#
# The scaffold is pinned, and bumped deliberately: a harness CI that goes red
# on an upstream scaffold release is rot. create-expo-app fetches its template
# from npm at the template's latest version, so the template is pinned too.
# The pins fix the files the scaffold writes, not what gets installed: the
# scaffold's dependencies (expo ~58, typescript ~6 and every transitive one)
# and create-expo-app's own float within their ranges, with no lockfile
# (E-036). A red install or scaffold step with no cookwright change is an
# upstream release, not a regression. Lifecycle scripts are not run.
set -euo pipefail

CREATE_EXPO_APP_VERSION="5.0.0"
TEMPLATE="expo-template-blank-typescript@58.0.21"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OVERLAY="$ROOT/fixtures/expo-overlay"

# Messages, in one place.
MSG_HEAD="fixture: create-expo-app@$CREATE_EXPO_APP_VERSION, template $TEMPLATE"
MSG_SKIP="fixture: skipped, needs %s, run setup\n"
MSG_STEP="\n== %s\n"
MSG_FAIL="fixture: FAIL: %s\n"
MSG_DIR="fixture: working in %s\n"
MSG_OK="fixture: PASS, every step as expected"

fail() { printf "$MSG_FAIL" "$1" >&2; exit 1; }
step() { printf "$MSG_STEP" "$1"; }

# A missing tool is a skip, exit 0. FIXTURE_STRICT=1, set by this repo's
# workflow and nothing else, makes it a failure: there a skip would be a
# green job that tested nothing.
need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  [ "${FIXTURE_STRICT:-}" = 1 ] && fail "needs $1"
  printf "$MSG_SKIP" "$1"
  exit 0
}

# Every git call in the fixture, the scaffold's own included, sees one
# identity and one default branch, never this machine's global config.
isolate_git() {
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=main
  export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
  export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
}

# expect <file> <extended regex> <what>: the file holds a line matching it.
expect() { grep -Eq -- "$2" "$1" || fail "$3"; }

pack() {
  step "npm pack"
  (cd "$ROOT" && npm pack --workspace packages/cookwright --pack-destination "$WORK" >/dev/null)
  TARBALL="$(ls "$WORK"/cookwright-*.tgz)"
  echo "$TARBALL"
}

scaffold() {
  step "create-expo-app"
  (cd "$WORK" && npx --yes "create-expo-app@$CREATE_EXPO_APP_VERSION" app \
    --template "$TEMPLATE" --no-install --yes)
  APP="$WORK/app"
  for f in AGENTS.md CLAUDE.md .claude/settings.json package.json; do
    [ -f "$APP/$f" ] || fail "the scaffold wrote no $f"
  done
  (cd "$APP" && find . -path ./.git -prune -o -type f -print | sort)
}

overlay() {
  step "overlay, git init, one commit"
  cat "$OVERLAY/AGENTS.md" >> "$APP/AGENTS.md"
  cd "$APP"
  # The scaffold's own repo and "Initial commit" go: the fixture starts from
  # one controlled commit, in a repo of the app's own even when the temp dir
  # lies inside another work tree.
  rm -rf .git
  git init -q
  [ "$(git rev-parse --show-toplevel)" = "$(pwd -P)" ] || fail "the app is not its own repo"
  git add -A
  git commit -qm "fixture: the scaffold with the overlay"
  git log --oneline
}

install_package() {
  step "npm install --save-dev <tarball>"
  npm install --save-dev --ignore-scripts --no-audit --no-fund "$TARBALL"
}

init() {
  step "npx cookwright init"
  npx cookwright init | tee "$WORK/init.out" || fail "init exited non-zero"
  local row
  for row in 'wrote +cookwright\.json' 'updated +AGENTS\.md' 'kept +CLAUDE\.md' \
    'updated +\.claude/settings\.json' 'wrote +\.claude/skills/setup' \
    'wrote +\.claude/skills/bundle' 'wrote +\.claude/workflows/bundle-phase\.js' \
    'wrote +\.claude/workflows/docs-audit\.js' 'wrote +\.githooks/pre-commit' \
    'wrote +\.githooks/pre-push'; do
    expect "$WORK/init.out" "^$row " "init row missing: $row"
  done
  expect AGENTS.md "^This is an Expo" "init lost the scaffold's AGENTS.md text"
  expect AGENTS.md "^## My rules" "init lost the overlay's rule"
  node -e 'const s = JSON.parse(require("fs").readFileSync(".claude/settings.json", "utf8"));
    process.exit(s.enabledPlugins?.["expo@claude-plugins-official"] === true ? 0 : 1)' \
    || fail "init lost the scaffold's settings"
}

doctor() {
  step "npx cookwright doctor"
  npx cookwright doctor | tee "$WORK/doctor.out" || fail "doctor exited non-zero"
  expect "$WORK/doctor.out" "^level 0 declared: complete" "level 0 is not complete"
  expect "$WORK/doctor.out" " 0 FAIL, 0 WARN, " "doctor reported a FAIL or a WARN"
  if command -v gitleaks >/dev/null 2>&1; then
    expect "$WORK/doctor.out" "^PASS +tools\.gitleaks " "gitleaks is on PATH but tools.gitleaks is not PASS"
  fi
}

commit_through_hooks() {
  step "commit init's files through the hooks"
  [ "$(git config core.hooksPath)" = ".githooks" ] || fail "core.hooksPath is not .githooks"
  git add -A
  git commit -m "chore: cookwright init" 2>&1 | tee "$WORK/commit.out" || fail "the commit was refused"
  if command -v gitleaks >/dev/null 2>&1; then
    expect "$WORK/commit.out" "^pre-commit +PASS +secrets " "gitleaks is on PATH but the hook's secrets scan is not PASS"
  else
    expect "$WORK/commit.out" "^pre-commit +(PASS|SKIP) +secrets " "the pre-commit hook did not run"
  fi
  [ -z "$(git status --porcelain)" ] || fail "the tree is dirty after the commit"
}

rerun() {
  step "npx cookwright changelog --check, migrate, init again"
  npx cookwright changelog --check || fail "changelog --check exited non-zero"
  npx cookwright migrate | tee "$WORK/migrate.out" || fail "migrate exited non-zero"
  expect "$WORK/migrate.out" "already at version 2" "migrate did not read version 2"
  npx cookwright init >/dev/null || fail "a second init exited non-zero"
  [ -z "$(git status --porcelain)" ] || fail "a second init changed the tree"
}

links() {
  step "ls -la .claude/skills .claude/workflows"
  ls -la .claude/skills .claude/workflows
  local link
  for link in .claude/skills/* .claude/workflows/*; do
    [ -L "$link" ] || fail "$link is not a link"
    [ -e "$link" ] || fail "$link does not resolve"
  done
}

main() {
  echo "$MSG_HEAD"
  need git; need node; need npm; need npx
  isolate_git
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/cookwright-fixture.XXXXXX")"
  [ -n "${KEEP:-}" ] || trap 'rm -rf "$WORK"' EXIT
  printf "$MSG_DIR" "$WORK"
  pack; scaffold; overlay; install_package
  init; doctor; commit_through_hooks; rerun; links
  echo; echo "$MSG_OK"
}

main "$@"
