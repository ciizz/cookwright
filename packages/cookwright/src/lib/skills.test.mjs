// src/lib/skills.test.mjs — the skills the package ships: each SKILL.md opens with
// frontmatter a host can read, its first body line names its level (and the flag of
// a level above 0), and the setup skill's recipe names every doctor check.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CHECKS } from './doctor/registry.mjs';
import { PACKAGE_ROOT, SKILLS, SKILLS_DIR } from './hosts.mjs';

const root = path.join(PACKAGE_ROOT, SKILLS_DIR);
const shipped = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'SKILL.md')))
  .map((e) => e.name)
  .sort();
const read = (name) => fs.readFileSync(path.join(root, name, 'SKILL.md'), 'utf8');

/** `{ fields, body }` of a SKILL.md, or null when it does not open with frontmatter. */
function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return null;
  const fields = Object.fromEntries(
    m[1].split('\n').map((line) => /^(\w+):\s*(.*)$/.exec(line)).filter(Boolean).map(([, k, v]) => [k, v.trim()]),
  );
  return { fields, body: m[2] };
}

describe('shipped skills', () => {
  it('ships exactly the skills the host table lists', () => {
    expect(shipped).toEqual(Object.keys(SKILLS).sort());
  });

  it.each(shipped)('%s opens with frontmatter holding its name and a description', (name) => {
    const skill = parse(read(name));
    expect(skill).not.toBeNull();
    expect(skill.fields.name).toBe(name);
    expect(skill.fields.description?.length).toBeGreaterThan(0);
  });

  it.each(shipped)('%s names its level, and its flag above 0, on its first body line', (name) => {
    const first = parse(read(name)).body.split('\n').find((line) => line.trim());
    const { level } = SKILLS[name];
    expect(first).toMatch(new RegExp(`\\bLevel ${level}\\b`));
    if (level > 0) expect(first).toMatch(/\bexperimental\b/);
    else expect(first).not.toMatch(/experimental/);
  });
});

describe('the setup skill', () => {
  const text = read('setup');

  it('has a recipe for every check doctor runs', () => {
    for (const check of Object.keys(CHECKS)) expect(text).toContain(`\`${check}\``);
  });

  it('acts on every PASS row of its recipe at the end, since the loop skips PASS lines', () => {
    const end = text.slice(text.indexOf('## At the end'));
    const notes = [...text.matchAll(/^\|.*\| PASS \| `(?:… )?([^`]+)`/gm)].map((m) => m[1]);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(end).toContain(note);
  });
});
