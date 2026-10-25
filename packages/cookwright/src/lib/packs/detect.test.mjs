// src/lib/packs/detect.test.mjs — the packs a tree shows: package.json's
// dependencies and the files a manifest names, at the config root, with the
// evidence each one is named by.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { messages } from '../messages.mjs';
import { scratchRoot } from '../../test-helpers.mjs';
import { detectPacks } from './detect.mjs';

const TMP = scratchRoot('cookwright-detect-');
const m = messages.detect;
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
      fs.writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body));
    }
  }
  return root;
}

describe('detectPacks', () => {
  it('reads both packs on a scaffold-shaped tree, the file before the dependency', () => {
    const root = tree({
      'package.json': { dependencies: { expo: '~58.0.0', '@supabase/supabase-js': '^2.0.0' } },
      'supabase/config.toml': 'project_id = "app"\n',
    });
    expect(detectPacks(root)).toEqual([
      { name: 'expo', evidence: m.dependsOn('expo') },
      { name: 'supabase', evidence: m.file('supabase/config.toml') },
    ]);
    expect(m.dependsOn('expo')).toBe('package.json depends on expo');
    expect(m.file('supabase/config.toml')).toBe('supabase/config.toml exists');
  });

  it('reads supabase from the client dependency alone, a devDependency counting', () => {
    const root = tree({ 'package.json': { devDependencies: { '@supabase/supabase-js': '^2.0.0' } } });
    expect(detectPacks(root)).toEqual([{ name: 'supabase', evidence: m.dependsOn('@supabase/supabase-js') }]);
  });

  it('reads nothing on a bare tree, a package.json without them, or a config.toml that is a directory', () => {
    expect(detectPacks(tree({}))).toEqual([]);
    expect(detectPacks(tree({ 'package.json': { dependencies: { react: '19.0.0' }, scripts: { expo: 'x' } } }))).toEqual([]);
    expect(detectPacks(tree({ 'supabase/config.toml/': '' }))).toEqual([]);
  });

  it('survives a package.json that is not JSON, or whose dependencies are not an object', () => {
    expect(detectPacks(tree({ 'package.json': '{ not json', 'supabase/config.toml': '' }))).toEqual([
      { name: 'supabase', evidence: m.file('supabase/config.toml') },
    ]);
    expect(detectPacks(tree({ 'package.json': { dependencies: 'expo' } }))).toEqual([]);
    expect(detectPacks(tree({ 'package.json': '["expo"]' }))).toEqual([]);
  });
});
