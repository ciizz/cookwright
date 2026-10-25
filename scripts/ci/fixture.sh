#!/usr/bin/env bash
# The harness fixture (E-014): a real create-expo-app scaffold, the committed
# overlay appended, then the package's published shape (an npm pack tarball)
# installed and init, doctor, the hooks (a violating component refused by the
# standards check, then landed corrected), the gate's standards checks (the
# ratchet with no base on main and a rise on a branch, the types measure),
# changelog and migrate run against it.
# Runs locally and in CI: bash scripts/ci/fixture.sh. KEEP=1 keeps the temp dir;
# FIXTURE_STRICT=1 turns a missing tool from a skip into a failure.
#
# The scaffold is pinned, and bumped deliberately: a harness CI that goes red
# on an upstream scaffold release is rot. The pin is on create-expo, the
# package that holds the logic: create-expo-app is a shim that depends on
# `create-expo >=5.0.1`, so pinning it pins nothing (the first GitHub run,
# 2026-10-18, resolved 5.1.5 through it, which writes no CLAUDE.md). It
# fetches its template from npm at the template's latest version, so the
# template is pinned too. create-expo writes CLAUDE.md and .claude/settings.json
# only on a machine with Claude Code (~/.claude.json or ~/.claude; measured in
# 5.0.1); the fixture is a user with Claude Code, so the overlay supplies those
# two files, with the scaffold's own content, where the scaffold did not.
# The pins fix the files the scaffold writes, not what gets installed: the
# scaffold's dependencies (expo ~58, typescript ~6 and every transitive one)
# float within their ranges, with no lockfile (E-036). A red install or
# scaffold step with no cookwright change is an upstream release, not a
# regression. Lifecycle scripts are not run.
#
# The app is also what a user has after the two commands the getting-started
# guide names for the stack packs (stage-4 plan, dispositions 9 and 23), so
# init detects both packs and the standards measure something. `npx expo lint`
# installs eslint@^9.0.0 and eslint-config-expo and writes Expo's static
# eslint.config.js template (@expo/cli 58.1.15): the overlay supplies that file
# verbatim and the install step adds the two packages, with the expo pack's
# eslint-plugin-i18next, each pinned by exact version below and bumped by hand
# like the scaffold (the latest on 2026-10-25; eslint the latest 9.x, the
# range expo lint installs). `supabase init` writes supabase/config.toml (the
# overlay's, from supabase 2.98.1, its project_id set to the app's name); the
# overlay adds an empty supabase/migrations/. CI has no Supabase CLI.
set -euo pipefail

CREATE_EXPO_VERSION="5.0.1"
TEMPLATE="expo-template-blank-typescript@58.0.21"
ESLINT="eslint@9.39.5"
ESLINT_CONFIG_EXPO="eslint-config-expo@58.0.4"
I18NEXT_PLUGIN="eslint-plugin-i18next@6.1.5"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OVERLAY="$ROOT/fixtures/expo-overlay"

# Messages, in one place.
MSG_HEAD="fixture: create-expo@$CREATE_EXPO_VERSION, template $TEMPLATE, $ESLINT, $ESLINT_CONFIG_EXPO, $I18NEXT_PLUGIN"
MSG_FROM="fixture: %s from the %s\n"
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
  step "create-expo"
  (cd "$WORK" && npx --yes "create-expo@$CREATE_EXPO_VERSION" app \
    --template "$TEMPLATE" --no-install --yes)
  APP="$WORK/app"
  for f in AGENTS.md package.json; do
    [ -f "$APP/$f" ] || fail "the scaffold wrote no $f"
  done
  (cd "$APP" && find . -path ./.git -prune -o -type f -print | sort)
}

overlay() {
  step "overlay, git init, one commit"
  cat "$OVERLAY/AGENTS.md" >> "$APP/AGENTS.md"
  # What npx expo lint and supabase init write (the install step adds the
  # packages expo lint installs).
  cp "$OVERLAY/eslint.config.js" "$APP/eslint.config.js"
  cp -R "$OVERLAY/supabase" "$APP/supabase"
  # The Claude Code files: the scaffold's when it wrote them (a machine with
  # Claude Code), the overlay's copies of the same content otherwise.
  local f
  for f in CLAUDE.md .claude/settings.json; do
    if [ -f "$APP/$f" ]; then
      printf "$MSG_FROM" "$f" scaffold
    else
      mkdir -p "$APP/$(dirname "$f")"
      cp "$OVERLAY/claude/$f" "$APP/$f"
      printf "$MSG_FROM" "$f" overlay
    fi
  done
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
  step "npm install --save-dev <tarball> $ESLINT $ESLINT_CONFIG_EXPO $I18NEXT_PLUGIN"
  npm install --save-dev --ignore-scripts --no-audit --no-fund "$TARBALL" \
    "$ESLINT" "$ESLINT_CONFIG_EXPO" "$I18NEXT_PLUGIN"
}

init() {
  step "npx cookwright init"
  npx cookwright init | tee "$WORK/init.out" || fail "init exited non-zero"
  local row
  for row in 'wrote +cookwright\.json' 'updated +AGENTS\.md' 'kept +CLAUDE\.md' \
    'updated +\.claude/settings\.json' 'wrote +\.claude/skills/setup' \
    'wrote +\.claude/skills/bundle' 'wrote +\.claude/workflows/bundle-phase\.js' \
    'wrote +\.claude/workflows/docs-audit\.js' 'wrote +\.githooks/pre-commit' \
    'wrote +\.githooks/pre-push' 'updated +AGENTS\.md#expo' \
    'updated +AGENTS\.md#supabase' 'wrote +docs/design-system\.md' \
    'wrote +docs/data-model\.md' 'updated +eslint\.config\.js' \
    'kept +eslint-plugin-i18next'; do
    expect "$WORK/init.out" "^$row " "init row missing: $row"
  done
  expect "$WORK/init.out" \
    "^wrote +cookwright\.json +.*packs: expo \(package\.json depends on expo\), supabase \(supabase/config\.toml exists\);" \
    "init did not detect both packs"
  local pack
  for pack in expo supabase; do
    expect AGENTS.md "^<!-- cookwright:begin pack $pack v[0-9]+ -->$" "AGENTS.md has no $pack section"
    expect eslint.config.js "^  \.\.\.require\('cookwright/packs/$pack/eslint\.cjs'\),$" \
      "eslint.config.js does not spread the $pack export"
  done
  node -e 'const c = JSON.parse(require("fs").readFileSync("cookwright.json", "utf8"));
    const names = (l) => l.map((x) => x.name).join(",");
    process.exit(c.version === 3 && c.packs.join(",") === "expo,supabase"
      && names(c.hooks.docSync) === "expo:design-doc,supabase:data-doc"
      && names(c.gate.checks) === "standards,standards:types" ? 0 : 1)' \
    || fail "cookwright.json does not carry the packs, their doc-sync rules and gate checks"
  expect AGENTS.md "^This is an Expo" "init lost the scaffold's AGENTS.md text"
  expect AGENTS.md "^## My rules" "init lost the overlay's rule"
  node -e 'const s = JSON.parse(require("fs").readFileSync(".claude/settings.json", "utf8"));
    process.exit(s.enabledPlugins?.["expo@claude-plugins-official"] === true ? 0 : 1)' \
    || fail "init lost the scaffold's settings"
}

# The level line is tool-aware (stage-4 disposition 18): complete only when
# every required row measured; otherwise "not verified:" names exactly the
# rows of the absent tools. Of the two tools, only gitleaks has such a row
# here: the scaffold's CLAUDE.md imports @AGENTS.md, so host.rules reads the
# import and measures without claude on PATH (measured 2026-10-25 with both
# hidden), and that PASS is asserted too.
expect_level() {
  expect "$WORK/doctor.out" "^PASS +host\.rules +CLAUDE\.md imports @AGENTS\.md$" \
    "host.rules does not read the scaffold's CLAUDE.md import"
  if command -v gitleaks >/dev/null 2>&1; then
    expect "$WORK/doctor.out" "^level 0 declared: complete$" "level 0 is not complete"
  else
    expect "$WORK/doctor.out" "^level 0 declared: not verified: tools\.gitleaks \(see their lines\)$" \
      "gitleaks is absent but the level line does not name exactly tools.gitleaks as not verified"
  fi
}

# pack.supabase.types is the one row that depends on a tool the fixture does not
# install (stage-4 disposition 18): with supabase on PATH it WARNs, the overlay
# having no db:types script, and is the only WARN; without it, it SKIPs.
expect_types_row() {
  if command -v supabase >/dev/null 2>&1; then
    expect "$WORK/doctor.out" " 0 FAIL, 1 WARN, " "doctor reported a FAIL, or a WARN besides pack.supabase.types"
    expect "$WORK/doctor.out" "^WARN +pack\.supabase\.types +no db:types script in package\.json" \
      "supabase is on PATH but pack.supabase.types does not WARN for the missing db:types script"
  else
    expect "$WORK/doctor.out" " 0 FAIL, 0 WARN, " "doctor reported a FAIL or a WARN"
    expect "$WORK/doctor.out" "^SKIP +pack\.supabase\.types +skipped, needs supabase" \
      "supabase is not on PATH but pack.supabase.types does not SKIP naming it"
  fi
}

doctor() {
  step "npx cookwright doctor"
  npx cookwright doctor | tee "$WORK/doctor.out" || fail "doctor exited non-zero"
  expect_level
  expect_types_row
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
  expect "$WORK/commit.out" "^pre-commit +PASS +standards " "the hook's standards check is not PASS on init's files"
  [ -z "$(git status --porcelain)" ] || fail "the tree is dirty after the commit"
}

# A component that adds a colour literal and a literal JSX string, with its
# design-system row (so doc-sync passes and only standards judges it), is
# refused by the real ESLint naming both; the same file through t() and a
# theme token lands.
GREETING_BAD="import { Text } from 'react-native';

export function Greeting() {
  return <Text style={{ color: '#ff0000' }}>Hello there</Text>;
}"
GREETING_GOOD="import { Text } from 'react-native';

import { styles, t } from '../theme';

export function Greeting() {
  return <Text style={styles.greeting}>{t('greeting.hello')}</Text>;
}"

standards_commit() {
  step "a violating component refused by standards, the corrected one landed"
  mkdir -p src/components
  printf '%s\n' "$GREETING_BAD" > src/components/Greeting.tsx
  printf '| Greeting | src/components/Greeting.tsx | none | |\n' >> docs/design-system.md
  git add src/components/Greeting.tsx docs/design-system.md
  local head; head="$(git rev-parse HEAD)"
  if git commit -m "feat: greeting" > "$WORK/refused.out" 2>&1; then
    cat "$WORK/refused.out"; fail "the violating commit landed"
  fi
  cat "$WORK/refused.out"
  [ "$(git rev-parse HEAD)" = "$head" ] || fail "the violating commit moved HEAD"
  expect "$WORK/refused.out" "^pre-commit +PASS +doc-sync " "doc-sync did not pass the component with its doc"
  expect "$WORK/refused.out" "^src/components/Greeting\.tsx:4:[0-9]+ +expo tokens " "standards did not name the colour literal"
  expect "$WORK/refused.out" "^src/components/Greeting\.tsx:4:[0-9]+ +expo strings " "standards did not name the JSX string"
  expect "$WORK/refused.out" "^pre-commit +FAIL +standards .*Greeting\.tsx expo strings 0 → 1, expo tokens 0 → 1" \
    "the standards FAIL does not name the file and both rules"
  grep -q "Hello there" "$WORK/refused.out" && fail "a standards line echoed the literal"
  printf '%s\n' "$GREETING_GOOD" > src/components/Greeting.tsx
  git add src/components/Greeting.tsx
  git commit -m "feat: greeting" 2>&1 | tee "$WORK/landed.out" || fail "the corrected commit was refused"
  expect "$WORK/landed.out" "^pre-commit +PASS +standards +1 staged file\(s\), no rise" "standards did not pass the corrected component"
  [ -z "$(git status --porcelain)" ] || fail "the tree is dirty after the corrected commit"
}

# The gate's two checks on the fixture: on main with no upstream the ratchet has
# no base, and the types measure has no db:types script, both exit 11 naming
# why. On a branch, a violating component landed with the escape is a rise the
# ratchet names, measured by the real ESLint; the branch is then dropped.
branch_measures() {
  step "npx cookwright standards --ratchet and --types"
  local code
  code=0; npx cookwright standards --ratchet > "$WORK/ratchet.out" || code=$?
  cat "$WORK/ratchet.out"
  [ "$code" = 11 ] || fail "standards --ratchet on main with no upstream exited $code, not 11"
  expect "$WORK/ratchet.out" "^skipped, no base to ratchet against \(tried: main@\{upstream\}\)$" \
    "standards --ratchet did not name the base it tried"
  code=0; npx cookwright standards --types > "$WORK/types.out" || code=$?
  cat "$WORK/types.out"
  [ "$code" = 11 ] || fail "standards --types without a db:types script exited $code, not 11"
  expect "$WORK/types.out" "^skipped, no db:types script in package\.json" "standards --types did not name the missing script"
  git checkout -qb feat
  mkdir -p src/components
  printf '%s\n' "$GREETING_BAD" > src/components/Farewell.tsx
  printf '| Farewell | src/components/Farewell.tsx | none | |\n' >> docs/design-system.md
  git add src/components/Farewell.tsx docs/design-system.md
  COOKWRIGHT_SKIP=standards git commit -qm "feat: farewell (standards skipped to test the ratchet)" > /dev/null 2>&1 \
    || fail "the escaped commit was refused"
  code=0; npx cookwright standards --ratchet > "$WORK/rose.out" || code=$?
  cat "$WORK/rose.out"
  [ "$code" = 10 ] || fail "standards --ratchet on a branch with a new violation exited $code, not 10"
  expect "$WORK/rose.out" "^a pack rule's count rose since [0-9a-f]{8} \(merge-base main HEAD\): expo strings 0 → 1 in src/components/Farewell\.tsx, expo tokens 0 → 1 in src/components/Farewell\.tsx" \
    "the ratchet's first line does not name both risen rules and the file"
  expect "$WORK/rose.out" "^src/components/Farewell\.tsx:4:[0-9]+ +expo tokens " "the ratchet did not name the colour literal"
  grep -q "Hello there" "$WORK/rose.out" && fail "a ratchet line echoed the literal"
  git checkout -q main
  git branch -qD feat
  [ -z "$(git status --porcelain)" ] || fail "the tree is dirty after the branch measures"
}

rerun() {
  step "npx cookwright changelog --check, migrate, init again"
  npx cookwright changelog --check || fail "changelog --check exited non-zero"
  npx cookwright migrate | tee "$WORK/migrate.out" || fail "migrate exited non-zero"
  expect "$WORK/migrate.out" "already at version 3" "migrate did not read version 3"
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
  init; doctor; commit_through_hooks; standards_commit; branch_measures; rerun; links
  echo; echo "$MSG_OK"
}

main "$@"
