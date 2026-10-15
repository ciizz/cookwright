// src/lib/rules/block.test.mjs — the managed block: its render and the one
// definition of "current" that init and doctor share.

import { describe, expect, it } from 'vitest';

import { DEFAULTS } from '../config.mjs';
import { CLI } from '../messages.mjs';
import {
  END_MARKER,
  RULES_VERSION,
  beginMarker,
  blockState,
  hasImport,
  renderBlock,
  renderTemplate,
} from './block.mjs';

const config = { ...DEFAULTS, paths: { ...DEFAULTS.paths, backlog: 'notes/todo.md' } };
const block = renderBlock(config);

describe('renderBlock', () => {
  it('wraps the template in the versioned markers, rendered with the config', () => {
    const lines = block.split('\n');
    expect(lines[0]).toBe(`<!-- cookwright:begin rules v${RULES_VERSION} -->`);
    expect(lines.at(-1)).toBe(END_MARKER);
    expect(block).toMatch(/managed by cookwright/);
    expect(block).toContain('`notes/todo.md`');
    expect(block).toContain(`\`${CLI} init\``);
    expect(block).not.toMatch(/\{\{|\r/);
  });

  it('refuses a placeholder with no value', () => {
    expect(() => renderTemplate('{{paths.nope}}', { paths: {} })).toThrow(/\{\{paths\.nope\}\}/);
  });
});

describe('blockState', () => {
  const file = (inner) => `# My rules\n\nmine\n\n${inner}\n\nmore of mine\n`;

  it('absent, current and the block’s span', () => {
    expect(blockState('# rules\n', block)).toEqual({ state: 'absent' });
    expect(blockState(`${END_MARKER}\n`, block).state).toBe('absent');
    const text = file(block);
    const s = blockState(text, block);
    expect(s.state).toBe('current');
    expect(text.slice(s.start, s.end)).toBe(block);
  });

  it('stale by version and by content; newer above the package', () => {
    const old = block.replace(beginMarker(), beginMarker(RULES_VERSION - 1));
    expect(blockState(file(old), block)).toMatchObject({ state: 'stale', version: RULES_VERSION - 1 });
    expect(blockState(file(block.replace('managed', 'edited')), block).state).toBe('stale');
    const newer = block.replace(beginMarker(), beginMarker(RULES_VERSION + 1));
    expect(blockState(file(newer), block)).toMatchObject({ state: 'newer', version: RULES_VERSION + 1 });
  });

  it('malformed with no end, or with two begins', () => {
    expect(blockState(file(`${beginMarker()}\nno end`), block)).toEqual({
      state: 'malformed',
      reason: 'noEnd',
    });
    expect(blockState(file(`${block}\n${block}`), block)).toEqual({
      state: 'malformed',
      reason: 'twoBegins',
    });
  });

  it('takes the first end marker; a later one is user text', () => {
    const text = file(`${block}\n\n${END_MARKER}\n`);
    const s = blockState(text, block);
    expect(s.state).toBe('current');
    expect(text.slice(s.end)).toContain(END_MARKER);
  });

  it('judges a CRLF file by the same render', () => {
    const crlf = file(block).replace(/\n/g, '\r\n');
    expect(blockState(crlf, block).state).toBe('current');
  });

  it('needs the markers on lines of their own', () => {
    expect(blockState(`see \`${beginMarker()}\` in the docs\n`, block).state).toBe('absent');
  });
});

describe('hasImport', () => {
  it('finds the token as a word outside code', () => {
    expect(hasImport('@AGENTS.md\n', '@AGENTS.md')).toBe(true);
    expect(hasImport('# Rules\r\nsee @AGENTS.md here\r\n', '@AGENTS.md')).toBe(true);
    expect(hasImport('use `@AGENTS.md` to import\n', '@AGENTS.md')).toBe(false);
    expect(hasImport('```\n@AGENTS.md\n```\n', '@AGENTS.md')).toBe(false);
    expect(hasImport('~~~md\n@AGENTS.md\n~~~\nafter\n', '@AGENTS.md')).toBe(false);
    expect(hasImport('```\ncode\n```\n@AGENTS.md\n', '@AGENTS.md')).toBe(true);
    expect(hasImport('@AGENTS.mdx\n', '@AGENTS.md')).toBe(false);
    expect(hasImport('@./AGENTS.md\n', '@AGENTS.md')).toBe(true);
    expect(hasImport('@../AGENTS.md\n', '@AGENTS.md')).toBe(false);
  });
});
