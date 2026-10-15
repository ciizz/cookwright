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
  noConfig: (cwd) => `no ${CONFIG_FILE} in ${cwd} or above it in this repo; ${RUN_INIT}`,
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
      `${list(files)} shadow(s) AGENTS.md and the root CLAUDE.md does not carry ${token} (${RUN_INIT})`,
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

export const messages = {
  // the bin
  usage: (commands) => `usage: ${CLI} <${commands.join('|')}> …`,
  notBuiltYet: (command) => `${CLI} ${command} is not available in this build yet`,

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
};
