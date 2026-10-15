// src/lib/messages.test.mjs — user-facing strings live in messages.mjs (plan §4.9).
//
// A heuristic scan of the modules the plan names: any string literal outside
// messages.mjs that reads like prose (two words in a row, interpolations aside) is
// a finding, unless it is on the allowlist below, each entry with its reason. The
// bundle modules keep their literals until E-004; hosts.mjs (the hook command and
// its fallback lines) and config.mjs (the loader's messages) are exceptions by the
// plan's import rule, and the templates, the rules block and the generated
// changelog's render (stage-2 plan §4.8) are content.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SCANNED = [
  'bin',
  'src/cli-main.mjs',
  'src/init.mjs',
  'src/doctor.mjs',
  'src/lib/cli.mjs',
  'src/lib/init',
  'src/lib/doctor',
  'src/lib/levels.mjs',
  'src/lib/probes.mjs',
  'src/lib/rules/block.mjs',
  'src/lib/changelog',
];

/** Modules whose literals are content written into the user's repo, not messages. */
const EXEMPT = [
  'src/lib/changelog/render.mjs', // the generated changelog's section titles and count line
];

/** Literals that are not messages, by file. */
const ALLOWED = {
  'src/lib/init/config.mjs': ["'npm test'"], // the gate command written into the config
  'src/lib/doctor/homes.mjs': ["'Open bugs'", "'Open enhancements'"], // the backlog's headings: content
  'src/lib/doctor/secrets.mjs': ["'git ls-files'"], // the command a probe failure names
  'src/lib/probes.mjs': ['`git check-ignore ${rel}`', "'git check-ignore'"], // the command a probe failure names
  'src/lib/rules/block.mjs': ['`<!-- cookwright:begin rules v${version} -->`'], // the marker: content
};

const sources = () =>
  SCANNED.flatMap((rel) => {
    const abs = path.join(PKG, rel);
    if (!fs.statSync(abs).isDirectory()) return [rel];
    return fs
      .readdirSync(abs)
      .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
      .map((f) => path.posix.join(rel, f))
      .filter((f) => !EXEMPT.includes(f));
  });

const COMMENTS = [/\/\*[\s\S]*?\*\//g, /^\s*\/\/.*$/gm, /\s\/\/ .*$/gm];
// A regex literal: a slash after an operator, a bracket or `return`.
const REGEX = /(^|[=(,:!&|?{};]|return)\s*\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/gm;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const PROSE = /[A-Za-z]{2,} +[A-Za-z]{2,}/;

function prose(rel) {
  let src = fs.readFileSync(path.join(PKG, rel), 'utf8');
  for (const re of COMMENTS) src = src.replace(re, '');
  src = src.replace(REGEX, '$1');
  return [...src.matchAll(LITERAL)]
    .map(([lit]) => lit)
    .filter((lit) => PROSE.test(lit.slice(1, -1).replace(/\$\{[^}]*\}/g, ' ')))
    .filter((lit) => !(ALLOWED[rel] ?? []).includes(lit));
}

describe('user-facing strings', () => {
  it('live in messages.mjs, not in the modules of plan §4.9', () => {
    const found = sources().flatMap((rel) => prose(rel).map((lit) => `${rel}: ${lit}`));
    expect(found).toEqual([]);
  });

  it('the scan finds a stray message and skips a regex holding a backtick', () => {
    const src = "const r = /(`+) two words/; throw new Refusal('this is a stray message'); f(/`/);";
    let s = src.replace(REGEX, '$1');
    s = [...s.matchAll(LITERAL)].map(([l]) => l).filter((l) => PROSE.test(l));
    expect(s).toEqual(["'this is a stray message'"]);
  });
});
