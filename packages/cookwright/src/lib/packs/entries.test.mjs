// src/lib/packs/entries.test.mjs — the omission listers' exact shapes (stage-4 plan
// disposition 33) and the table-cell reader they are compared against.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scratchRoot } from '../../test-helpers.mjs';
import { LISTERS, MIGRATION, docKeys, headingKeys, listComponents, listMigrations, tableKeys } from './entries.mjs';
import { PACKS } from './registry.mjs';

const TMP = scratchRoot('cookwright-entries-');
let n = 0;

/** A directory under TMP holding `files` (rel → text; a trailing slash makes a directory). */
function tree(files) {
  const root = path.join(TMP, `t${(n += 1)}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    if (rel.endsWith('/')) fs.mkdirSync(abs, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
  }
  return root;
}

describe('listComponents', () => {
  it('lists .tsx and .jsx files by basename and a directory index by the directory, each once', () => {
    const root = tree({
      'src/components/Button.tsx': '',
      'src/components/Card.jsx': '',
      'src/components/Avatar/index.tsx': '',
      'src/components/Avatar/Avatar.styles.ts': '',
      'src/components/Chip/index.jsx': '',
      'src/components/Fab.tsx': '',
      'src/components/Fab/index.tsx': '', // the same name as a file and as a directory
      'components/Tag.tsx': '',
    });
    expect(listComponents(root, ['src/components', 'components'])).toEqual(['Avatar', 'Button', 'Card', 'Chip', 'Fab', 'Tag']);
  });

  it('names a platform file by its primitive, once, and takes a platform index as a directory’s', () => {
    const root = tree({
      'components/Map.web.tsx': '',
      'components/Map.native.tsx': '',
      'components/Sheet.ios.jsx': '',
      'components/Card/index.ios.tsx': '',
      'components/Card/index.android.tsx': '',
      'components/Card/Card.styles.ts': '',
      'components/index.web.tsx': '',
      'components/Map.web.test.tsx': '',
    });
    expect(listComponents(root, ['components'])).toEqual(['Card', 'Map', 'Sheet']);
  });

  it('leaves out the top-level index, companion files, .ts and .js helpers, dotfiles and directories with no index', () => {
    const root = tree({
      'src/components/index.tsx': '',
      'src/components/.gitkeep': '',
      'src/components/.Hidden.tsx': '',
      'src/components/Button.test.tsx': '',
      'src/components/Button.stories.tsx': '',
      'src/components/Button.styles.tsx': '',
      'src/components/Button.types.tsx': '',
      'src/components/helpers.ts': '',
      'src/components/format.js': '',
      'src/components/hooks/useTheme.ts': '',
      'src/components/icons/Star.tsx': '', // two levels down: not a primitive by this shape
      'src/components/.private/index.tsx': '',
    });
    expect(listComponents(root, ['src/components'])).toEqual([]);
  });

  it('lists nothing for a code directory that does not exist, or that is a file', () => {
    expect(listComponents(tree({ 'App.tsx': '' }), ['src/components', 'components'])).toEqual([]);
    expect(listComponents(tree({ components: 'not a directory' }), ['components'])).toEqual([]);
  });
});

describe('an unreadable directory', () => {
  // root reads any directory, so the case only exists for another user.
  it.skipIf(process.getuid?.() === 0)('throws, never lists it as empty', () => {
    const root = tree({ 'components/Button.tsx': '', 'supabase/migrations/20261025120000_init.sql': '' });
    const dirs = ['components', 'supabase/migrations'].map((rel) => path.join(root, rel));
    dirs.forEach((dir) => fs.chmodSync(dir, 0o000));
    try {
      expect(() => listComponents(root, ['components'])).toThrow(expect.objectContaining({ code: 'EACCES' }));
      expect(() => listMigrations(root, ['supabase/migrations'])).toThrow(expect.objectContaining({ code: 'EACCES' }));
    } finally {
      dirs.forEach((dir) => fs.chmodSync(dir, 0o755));
    }
  });
});

describe('listMigrations', () => {
  it('lists the files named <14 digits>_<name>.sql directly under the directory, by file name', () => {
    const root = tree({
      'supabase/migrations/20261025120000_init.sql': '',
      'supabase/migrations/20261025130000_todos.sql': '',
      'supabase/migrations/.gitkeep': '',
      'supabase/migrations/2026_short.sql': '',
      'supabase/migrations/20261025140000_notes.txt': '',
      'supabase/migrations/20261025150000_.sql': '',
      'supabase/migrations/old/20261025160000_moved.sql': '',
      'supabase/migrations/20261025170000_dir.sql/': '',
    });
    expect(listMigrations(root, ['supabase/migrations'])).toEqual(['20261025120000_init.sql', '20261025130000_todos.sql']);
  });

  it('lists nothing on the blank scaffold', () => {
    expect(listMigrations(tree({ 'supabase/migrations/.gitkeep': '' }), ['supabase/migrations'])).toEqual([]);
    expect(listMigrations(tree({}), ['supabase/migrations'])).toEqual([]);
  });
});

describe('LISTERS', () => {
  it('has a lister for every entries kind a manifest doc names', () => {
    for (const mf of Object.values(PACKS)) for (const doc of mf.docs) expect(LISTERS[doc.entries]).toBeTypeOf('function');
  });
});

describe('tableKeys', () => {
  it('reads the first cell of every body row of every table, never a header or a separator', () => {
    const text = [
      '# Data model',
      '',
      '| Migration | Tables | Summary |',
      '| --- | --- | --- |',
      '| 20261025120000_init.sql | todos | first |',
      '|`20261025130000_todos.sql`|todos|second|',
      '',
      '| Table | Purpose |',
      '|:---|---:|',
      '| [todos](#todos) | the list |',
      '|  | an empty key |',
      'Not | a table row',
    ].join('\r\n');
    expect([...tableKeys(text)]).toEqual(['20261025120000_init.sql', '20261025130000_todos.sql', 'todos']);
  });

  it('reads no row of a table inside a fenced code block', () => {
    const text = ['```md', '| Primitive |', '| --- |', '| Ghost |', '```', '', '| Primitive |', '| --- |', '| Real |'].join('\n');
    expect([...tableKeys(text)]).toEqual(['Real']);
    expect([...docKeys('```md\n| Primitive |\n| --- |\n| Ghost |\n```\n')]).toEqual([]);
  });

  it('reads nothing from a template with empty tables', () => {
    const template = fs.readFileSync(new URL('../../../packs/supabase/templates/data-model.md', import.meta.url), 'utf8');
    expect(tableKeys(template).size).toBe(0);
    const design = fs.readFileSync(new URL('../../../packs/expo/templates/design-system.md', import.meta.url), 'utf8');
    expect(tableKeys(design).size).toBe(0);
  });
});

describe('headingKeys', () => {
  it('reads every ## and ### heading, closing hashes, code spans and links dropped, never one in a fence', () => {
    const text = [
      '# Design system',
      '',
      '## Primitives',
      '### Button',
      '###   `Card`   ###',
      '### [Chip](#chip)',
      '#### Avatar notes',
      '###NoSpace',
      '```md',
      '### Fenced',
      '~~~',
      '### StillFenced',
      '```',
      '  ### Indented',
      '###',
    ].join('\r\n');
    expect([...headingKeys(text)]).toEqual(['Primitives', 'Button', 'Card', 'Chip', 'Indented']);
  });

  it('closes a fence only on its own character, at least as long, with nothing after it', () => {
    const outer = ['````md', '```tsx', '## Inner', '```', '````', '## After'].join('\n');
    expect([...headingKeys(outer)]).toEqual(['After']);
    const tilde = ['~~~~', '~~~', '## Inner', '~~~~~', '## After'].join('\n');
    expect([...headingKeys(tilde)]).toEqual(['After']);
    const info = ['```md', '```tsx', '## Inner', '```', '## After'].join('\n');
    expect([...headingKeys(info)]).toEqual(['After']);
  });

  it('follows a fence a list item opens to its closing line, indented as the item’s content', () => {
    const bullet = ['- ```md', '  ## Phantom', '  ```', '## Real'].join('\n');
    expect([...headingKeys(bullet)]).toEqual(['Real']);
    const numbered = ['1. ```md', '   ## Phantom', '', '   | Ghost |', '   ```', '## Real'].join('\n');
    expect([...headingKeys(numbered)]).toEqual(['Real']);
    const nested = ['- 1. ~~~', '     ## Phantom', '     ~~~', '### Real'].join('\n');
    expect([...headingKeys(nested)]).toEqual(['Real']);
    const table = ['* ```md', '  | Primitive |', '  | --- |', '  | Ghost |', '  ```', '| Primitive |', '| --- |', '| Real |'].join('\n');
    expect([...docKeys(table)].sort()).toEqual(['Real']);
  });

  it('ends a list item’s fence at a line less indented than the item’s content, as the item ends', () => {
    // CommonMark: `## Phantom` at column 0 closes the item, so it is a heading, and the
    // ``` after it opens a fence of its own at the top level, holding `## Real`.
    expect([...headingKeys(['- ```md', '## Phantom', '```', '## Real'].join('\n'))]).toEqual(['Phantom']);
    expect([...headingKeys(['- ```md', '  ## Phantom', '```', '## Inside', '```', '## Real'].join('\n'))]).toEqual(['Real']);
  });

  it('reads indentation in columns, a tab reaching the next multiple of four', () => {
    // A tab-indented line sits at column 4, inside an item whose content starts at 2.
    expect([...docKeys('- ```md\n\t| Ghost | x |\n\t```\n\n## Real\n')]).toEqual(['Real']);
    expect([...headingKeys(['1.\t```md', '\t## Phantom', '\t```', '## Real'].join('\n'))]).toEqual(['Real']);
    // `-\t` puts the item's content at column 4, so a line at column 2 ends the item and its fence.
    expect([...tableKeys(['-\t```md', '  | Primitive |', '  | --- |', '  | Real |'].join('\n'))]).toEqual(['Real']);
    // At the top level, a tab is four columns: an indented code line, not a heading or a row.
    expect([...headingKeys('\t## Indented\n## Real\n')]).toEqual(['Real']);
    expect([...docKeys('\t| Ghost | x |\n## Real\n')]).toEqual(['Real']);
    expect([...docKeys('    | Ghost | x |\n## Real\n')]).toEqual(['Real']);
  });

  it('follows a fence on a list item’s continuation line, nested or not, from where the item’s content starts', () => {
    const fenced = (marker, indent) => [`${marker}Add a row like:`, `${indent}\`\`\`md`, `${indent}| Ghost | x |`, `${indent}\`\`\``, '', '## Real'].join('\n');
    expect([...docKeys(fenced('- ', '\t'))]).toEqual(['Real']);
    expect([...docKeys(fenced('10. ', '    '))]).toEqual(['Real']);
    expect([...docKeys(fenced('-   ', '    '))]).toEqual(['Real']);
    expect([...docKeys(fenced('- Example:\n  - ', '    '))]).toEqual(['Real']);
    // Four columns past the item's content is an indented code line; less is the item's own row.
    expect([...docKeys(['- Item', '', '      | Ghost | x |', '## Real'].join('\n'))]).toEqual(['Real']);
    expect([...tableKeys(['1. Primitives', '', '    | Primitive |', '    | --- |', '    | Real |'].join('\n'))]).toEqual(['Real']);
  });

  it('reads a thematic break as no list item, so an indented line after it is code', () => {
    expect([...docKeys('- - -\n    | Ghost | x |\n## Real\n')]).toEqual(['Real']);
    expect([...docKeys('* * *\n    ## Ghost\n## Real\n')]).toEqual(['Real']);
    expect([...docKeys(' -  -  -\t\n    ## Ghost\n## Real\n')]).toEqual(['Real']);
    // An item whose content is a break stays an item: its content starts at column 2.
    expect([...docKeys('- * * *\n  ## Inside\n')]).toEqual(['Inside']);
    // Two markers are not a break: the nested item's content starts at column 4.
    expect([...docKeys('- -\n    ## Nested\n')]).toEqual(['Nested']);
  });

  it('reads no heading or row inside a blockquote, fenced or not (E-052)', () => {
    expect([...docKeys(['> ```md', '> | Ghost | x |', '> ## GhostH', '> ```', '## Real'].join('\n'))]).toEqual(['Real']);
    expect([...docKeys(['> ## Button', '> | Card | x |', '- > ## Chip', '## Real'].join('\n'))]).toEqual(['Real']);
  });

  it('reads a backtick line whose info string holds a backtick as a paragraph, not a fence', () => {
    expect([...headingKeys('```inline``` text\n## Button')]).toEqual(['Button']);
  });
});

describe('docKeys', () => {
  it('counts a headings-shaped doc and a table-shaped one alike', () => {
    const headings = '# Design system\n\n### Avatar\n\nA round image.\n\n### Button\n\n| Prop | Type |\n| --- | --- |\n| label | string |\n';
    expect([...docKeys(headings)].sort()).toEqual(['Avatar', 'Button', 'label']);
    const table = '| Primitive | File |\n| --- | --- |\n| Avatar | Avatar.tsx |\n';
    expect([...docKeys(table)]).toEqual(['Avatar']);
  });

  it('reads no entry a lister could name from either template', () => {
    const read = (rel) => fs.readFileSync(new URL(`../../../packs/${rel}`, import.meta.url), 'utf8');
    expect([...docKeys(read('expo/templates/design-system.md'))]).toEqual([]);
    expect([...docKeys(read('supabase/templates/data-model.md'))].filter((k) => MIGRATION.test(k))).toEqual([]);
  });
});
