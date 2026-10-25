// src/lib/rules/block.test.mjs — the managed block: its render and the one
// definition of "current" that init and doctor share.

import { describe, expect, it } from 'vitest';

import { DEFAULTS } from '../config.mjs';
import { CLI } from '../messages.mjs';
import {
  CORE_KIND,
  END_MARKER,
  RULES_VERSION,
  beginMarker,
  blockState,
  hasImport,
  packKind,
  renderBlock,
  renderTemplate,
} from './block.mjs';
import { v2Block } from '../../test-helpers.mjs';

/** The paragraph after `heading` in `text`. */
const paragraph = (text, heading) => text.split(`${heading}\n\n`)[1].split('\n\n')[0];

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

  it('is v3, whose Session start points at the setup skill', () => {
    expect(RULES_VERSION).toBe(3);
    expect(paragraph(block, '## Session start')).toContain(
      "On a FAIL whose line does not clear it, on an update, or when the developer asks, the `setup` skill walks doctor's readout.",
    );
  });

  it('reads a v2 block as stale', () => {
    expect(blockState(`${v2Block(block)}\n`, block)).toMatchObject({ state: 'stale', version: 2 });
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

describe('kinds: the core block and a pack section in one file', () => {
  const expo = packKind('expo');
  const section = (body = 'expo rules', version = 1) => `${beginMarker(version, expo)}\n${body}\n${END_MARKER}`;
  const both = `# My rules\n\n${block}\n\n${section()}\n\nmine\n`;

  it('keeps the core markers byte for byte, the kind defaulting to the core', () => {
    expect(CORE_KIND).toBe('rules');
    expect(beginMarker()).toBe('<!-- cookwright:begin rules v3 -->');
    expect(beginMarker(RULES_VERSION, CORE_KIND)).toBe(beginMarker());
    expect(beginMarker(1, expo)).toBe('<!-- cookwright:begin pack expo v1 -->');
    expect(blockState(both, block)).toEqual(blockState(both, block, CORE_KIND));
  });

  it('finds each block by its own marker, its span ending at its own end marker', () => {
    const core = blockState(both, block);
    expect(core.state).toBe('current');
    expect(both.slice(core.start, core.end)).toBe(block);
    const pack = blockState(both, section(), expo);
    expect(pack).toMatchObject({ state: 'current', version: 1 });
    expect(both.slice(pack.start, pack.end)).toBe(section());
    // In either order.
    const swapped = `${section()}\n\n${block}\n`;
    expect(blockState(swapped, block).state).toBe('current');
    expect(blockState(swapped, section(), expo).state).toBe('current');
  });

  it('reads a pack section absent, stale, newer and malformed on its own, the core untouched', () => {
    expect(blockState(`${block}\n`, section(), expo)).toEqual({ state: 'absent' });
    expect(blockState(both, section('edited'), expo).state).toBe('stale');
    expect(blockState(both, section('expo rules', 2), expo)).toMatchObject({ state: 'stale', version: 1 });
    expect(blockState(both, section('expo rules', 0), expo)).toMatchObject({ state: 'newer', version: 1 });
    expect(blockState(`${both}\n${section()}\n`, section(), expo)).toEqual({ state: 'malformed', reason: 'twoBegins' });
    expect(blockState(both, block).state).toBe('current');
    // Another pack's section is not this one's.
    expect(blockState(both, section(), packKind('supabase'))).toEqual({ state: 'absent' });
  });

  it('never lets a block missing its end take the next block’s', () => {
    const coreOpen = `${beginMarker()}\nno end here\n\n${section()}\n`;
    expect(blockState(coreOpen, block)).toEqual({ state: 'malformed', reason: 'noEnd' });
    expect(blockState(coreOpen, section(), expo).state).toBe('current');
    const packOpen = `${beginMarker(1, expo)}\nno end\n\n${block}\n`;
    expect(blockState(packOpen, section(), expo)).toEqual({ state: 'malformed', reason: 'noEnd' });
    expect(blockState(packOpen, block).state).toBe('current');
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
