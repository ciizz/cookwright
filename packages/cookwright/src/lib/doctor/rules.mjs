// src/lib/doctor/rules.mjs — the managed rules block is what the package ships, and
// no rules file outgrows what an agent reads whole.

import fs from 'node:fs';
import path from 'node:path';

import { HOSTS } from '../hosts.mjs';
import { messages } from '../messages.mjs';
import { RULES_FILE, blockState, renderBlock } from '../rules/block.mjs';
import { fail, pass, warn } from '../verdict.mjs';
import { isFile, readLF } from './repo.mjs';

const m = messages.doctor;

export const SIZE_CAP = 60 * 1024;
export const LINE_CAP = 3000;

export function checkBlock(repo) {
  const abs = path.join(repo.root, RULES_FILE);
  if (!isFile(abs)) return fail(m.block.noFile(RULES_FILE));
  const s = blockState(readLF(abs), renderBlock(repo.config));
  switch (s.state) {
    case 'current':
      return pass(m.block.current(RULES_FILE));
    case 'newer':
      return warn(m.block.newer(RULES_FILE, s.version));
    case 'stale':
      return fail(m.block.stale(RULES_FILE));
    case 'malformed':
      return fail(m.block.malformed(RULES_FILE, s.reason));
    default:
      return fail(m.block.absent(RULES_FILE));
  }
}

/** Every rules file any host reads, at the root: AGENTS.md first, then each host's. */
const rulesFileNames = () => [
  ...new Set([RULES_FILE, ...Object.values(HOSTS).flatMap((h) => [...h.rules, ...h.shadowing])]),
];

/** Over either cap is a WARN naming the file and the size. Needs no config. */
export function checkSize(repo) {
  const files = rulesFileNames().filter((f) => isFile(path.join(repo.root, f)));
  if (!files.length) return pass(m.size.none);
  const problems = [];
  for (const file of files) {
    const abs = path.join(repo.root, file);
    const bytes = fs.statSync(abs).size;
    if (bytes > SIZE_CAP) problems.push(m.size.big(file, Math.ceil(bytes / 1024)));
    const lines = readLF(abs).split('\n');
    const long = lines.findIndex((l) => l.length > LINE_CAP);
    if (long !== -1) problems.push(m.size.longLine(file, long + 1, lines[long].length));
  }
  return problems.length ? warn(problems.join('; ')) : pass(m.size.ok(files));
}
