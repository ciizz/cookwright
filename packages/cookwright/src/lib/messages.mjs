// src/lib/messages.mjs — every user-facing line of the `cookwright` bin, the shared
// CLI pieces (cli.mjs), init and doctor, in one place, and the invocation they name
// themselves by. The bundle CLI's own guidance stays in lib/bundle/messages.mjs,
// which builds its invocation from CLI below.
//
// Import rule (no module cycle can form): this file may import from config.mjs;
// config.mjs and hosts.mjs never import this file, and levels.mjs imports nothing,
// so the level texts live here, keyed by level.

import { CONFIG_FILE } from './config.mjs';

/** How the package is invoked, as every printed command and every doc names it. */
export const CLI = 'npx cookwright';

const list = (names) => names.join(', ');
const RUN_INIT = `run ${CLI} init`;

// doctor: one note per verdict of each check (plan §4.8), then the readout's lines.
const doctor = {
  usage: `usage: ${CLI} doctor [--hook]`,
  refused: (detail) => `doctor: ${detail}`,
  noConfig: (cwd) => `no ${CONFIG_FILE} at or above ${cwd}; ${RUN_INIT}`,
  hookLine: (text) => `cookwright doctor: ${text}`,
  crashed: (detail) => `cookwright doctor crashed: ${detail}`,
  checkThrew: (detail) => `the check could not run: ${detail}`,
  needsGit: 'skipped, needs git, run setup',
  configInvalid: 'config invalid',

  config: { ok: (level) => `valid, level ${level}` },
  git: {
    ok: (base) => `work tree, baseBranch ${base}`,
    unborn: (base) => `work tree, baseBranch ${base} (no commits yet)`,
    configInvalid: 'work tree; baseBranch unverified, config invalid',
    noBase: (base) => `baseBranch ${base} does not exist`,
    notWorkTree: 'not a git work tree',
  },
  homes: {
    backlogOk: (file) => `${file}, with its three sections`,
    headingsMissing: (file, headings) =>
      `${file} lacks ${list(headings.map((h) => `"## ${h}"`))}`,
    fileOk: (file) => file,
    dirOk: (dir) => `${dir}/`,
    missing: (file) => `${file} missing (${RUN_INIT})`,
  },
  ids: {
    ok: (n) => `${n} id(s), each once`,
    duplicates: (ids) => `duplicate id(s): ${list(ids)}`,
    noBacklog: 'no backlog file',
  },
  block: {
    current: (file) => `${file}: the managed block is current`,
    newer: (file, v) => `${file}: block v${v} is newer than this cookwright (update cookwright)`,
    noFile: (file) => `no ${file}: Level 0's rules are not what the package ships (${RUN_INIT})`,
    absent: (file) => `${file} has no managed block: Level 0's rules are not what the package ships (${RUN_INIT})`,
    stale: (file) => `${file}: the managed block is stale (${RUN_INIT})`,
    malformed: (file, reason) =>
      `${file}: the managed block is malformed (${reason === 'noEnd' ? 'a begin marker with no end marker' : 'two begin markers'}); fix the markers by hand`,
  },
  size: {
    ok: (files) => `${list(files)}: under 60 KB, no line over 3000 chars`,
    none: 'no rules file to measure',
    big: (file, kb) => `${file} is ${kb} KB (cap 60 KB)`,
    longLine: (file, line, chars) => `${file} line ${line} is ${chars} chars (cap 3000)`,
  },
  hostRules: {
    imports: (file, token) => `${file} imports ${token}`,
    native: (version) => `claude ${version} reads AGENTS.md natively; nothing shadows it`,
    shadowed: (files, token) =>
      `AGENTS.md is shadowed by ${list(files)} and the root CLAUDE.md does not carry ${token} (${RUN_INIT})`,
    old: (version, min) =>
      `claude ${version} reads only CLAUDE.md (AGENTS.md needs ${min} or newer; ${RUN_INIT}, which writes the import)`,
    noClaude: 'skipped, needs claude, run setup (AGENTS.md support unverified)',
  },
  hostHook: {
    ok: (file) => `${file} runs doctor at session start`,
    past: (file) => `${file} has an earlier version of the doctor hook (${RUN_INIT})`,
    none: (file) =>
      `no doctor SessionStart hook in ${file}, so doctor runs only by hand (${RUN_INIT}; a hook in settings.local.json or the user settings is not what init wires)`,
    invalid: (file, detail) => `${file} is not valid JSON (${detail})`,
  },
  secrets: {
    ok: 'no .env file tracked or at the root; .env and .env.local ignored',
    tracked: (files) => `tracked env file(s): ${list(files)}; untrack them and rotate what they hold`,
    untracked: (files) => `${list(files)} at the root: a plaintext env file (Level 2 replaces it)`,
    notIgnored: (files) => `${list(files)} not ignored by git (${RUN_INIT})`,
    notWorkTree: 'not a git work tree',
  },

  summary: (n, c) => `${n} checks — ${c.passed} PASS, ${c.failed} FAIL, ${c.warned} WARN, ${c.skipped} SKIP`,
  levelUnknown: 'level unknown: config invalid',
  levelComplete: (level) => `level ${level} declared: complete`,
  levelDrift: (level, missing) =>
    `level ${level} declared: drift, ${missing.length} piece(s) missing: ${list(missing)}`,
  weak: (names) => `weak: ${list(names)}`,
  unverified: (names) => `unverified: ${list(names)}`,
  hookComplete: (level) => `cookwright doctor: level ${level} complete`,
  next: (text) => `next: ${text}`,
};

// init: the usage, the refusals, and one note per row of each step (plan §4.4).
const init = {
  usage: `usage: ${CLI} init [--base <branch>] [--dry-run]`,
  refused: (detail) => `init: ${detail}`,
  bundleFlag: (flag) => `--${flag} belongs to ${CLI} bundle init; ${CLI} init takes --base and --dry-run`,
  notWorkTree: (cwd) => `${cwd} is not inside a git work tree (init needs git and a repo: run git init first)`,
  notAFile: (rel) => `${rel} exists and is not a file; move it aside, then rerun`,
  notADir: (rel) => `${rel} exists and is not a directory; move it aside, then rerun`,
  gitFailed: (what, detail) => `git ${what} failed: ${detail}`,
  settingsInvalid: (file, detail) => `${file} is not valid JSON (${detail}); fix it by hand, then rerun`,
  settingsShape: (file, key) =>
    `${key ? `${file}: ${key}` : file} is not the shape Claude Code reads (an object, its hooks an object, hooks.SessionStart a list); fix it by hand, then rerun`,

  header: (root) => `${CLI} init in ${root}`,
  dryHeader: (root) => `${CLI} init --dry-run in ${root}: nothing is written`,
  dryFooter: 'dry run: nothing written, doctor skipped',

  config: {
    wrote: (base, gate) => `baseBranch ${base}; ${gate}`,
    kept: (level) => `present, level ${level}; init never edits an existing config`,
    gateTest: (run) => `gate: ${run}`,
    gateNone: (reason) => `gate: no checks (${reason})`,
    noPackage: 'no package.json',
    badPackage: 'package.json is not valid JSON',
    noTestScript: 'package.json has no test script',
    placeholder: "the test script is npm's placeholder",
    watch: 'the test script runs in watch mode and never exits',
  },
  homes: {
    template: 'from the template',
    gitkeep: 'created, with a .gitkeep so a clone keeps it',
    emptyDir: 'empty: .gitkeep added so a clone keeps it',
    present: 'present',
  },
  block: {
    wrote: 'written with the managed rules block',
    appended: 'managed rules block appended; your text is untouched',
    refreshed: (v) => `managed rules block refreshed to v${v}; the text outside the markers is untouched`,
    current: 'the managed rules block is current',
    newer: (v) => `block v${v} is newer than this cookwright; left alone (update cookwright)`,
  },
  hostRules: {
    imports: (token) => `imports ${token}`,
    prepended: (token) => `${token} prepended as the first line`,
    shadowed: (token, files) => `only ${token}: ${list(files)} would otherwise shadow AGENTS.md`,
    old: (token, version, min) =>
      `only ${token}: claude ${version} reads only CLAUDE.md (AGENTS.md needs ${min} or newer)`,
    native: (version) => `not needed: claude ${version} reads AGENTS.md natively and nothing shadows it`,
    noClaude: 'not needed: nothing shadows AGENTS.md (claude not on PATH, its version unverified)',
  },
  hostHook: {
    wrote: 'SessionStart hook runs doctor',
    kept: 'the doctor SessionStart hook is present',
    replaced: 'an earlier doctor hook replaced by the current one; the rest untouched',
    added: 'doctor SessionStart hook added; the other settings untouched',
  },
  gitignore: {
    ignored: '.env and .env.local are ignored',
    ignoredElsewhere: ".env and .env.local are ignored by git's own excludes",
    wrote: (lines) => `ignores ${list(lines)}`,
    appended: (lines) => `appended ${list(lines)}`,
    overridden: (paths) =>
      `${list(paths)} not ignored although .gitignore lists the patterns (a later rule overrides them); left alone`,
  },
};

export const messages = {
  // the bin
  usage: (commands) => `usage: ${CLI} <${commands.join('|')}> …`,

  // cli.mjs
  missing: (what) => `missing ${what}`,
  notANumber: (flag) => `--${flag} must be a number`,
  unknownFlag: (flag, allowed) =>
    allowed.length
      ? `unknown flag --${flag} (known: ${allowed.map((f) => `--${f}`).join(', ')})`
      : `unknown flag --${flag} (this command takes none)`,

  // levels
  levels: {
    0: {
      name: 'Level 0',
      summary: 'state homes, the managed rules block and the session-start doctor hook',
    },
  },
  noNextLevel: (level) => `Level ${level + 1} is not available in this version of cookwright`,

  // probes.mjs, rules/block.mjs
  probeFailed: (what, detail) => `${what} failed: ${detail}`,
  templateValue: (key) => `agents-block.md: no value for {{${key}}} (a packaging bug)`,

  doctor,
  init,
};
