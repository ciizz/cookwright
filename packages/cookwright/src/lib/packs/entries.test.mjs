// src/lib/packs/entries.test.mjs — the omission listers' exact shapes (stage-4 plan
// disposition 33) and the table-cell reader they are compared against.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scratchRoot } from '../../test-helpers.mjs';
import { LISTERS, listComponents, listMigrations, tableKeys } from './entries.mjs';
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

  it('reads nothing from a template with empty tables', () => {
    const template = fs.readFileSync(new URL('../../../packs/supabase/templates/data-model.md', import.meta.url), 'utf8');
    expect(tableKeys(template).size).toBe(0);
    const design = fs.readFileSync(new URL('../../../packs/expo/templates/design-system.md', import.meta.url), 'utf8');
    expect(tableKeys(design).size).toBe(0);
  });
});
