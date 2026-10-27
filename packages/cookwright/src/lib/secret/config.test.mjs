// src/lib/secret/config.test.mjs — what the engine reads from a valid config's
// `secrets`: the declared, ambient and pointer names, a target, the keychain
// service, and top-relative paths (stage-5 plan §4.1, dispositions 22, 29, 52, 54).

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { splitArgv } from '../cli.mjs';
import {
  RECIPIENTS,
  ambientNames,
  ciphertextOf,
  declaredNames,
  pointerNames,
  serviceOf,
  targetOf,
  templateOf,
  topRel,
} from './config.mjs';

const config = {
  packs: ['expo', { name: 'supabase', rules: { types: false } }],
  secrets: {
    backend: 'keychain',
    id: 'my-app',
    targets: { dev: { names: ['SUPABASE_URL', 'DB_URL'] }, prod: { names: ['DB_URL', 'SENTRY_DSN'] } },
  },
};

describe('the names', () => {
  it('declares every target’s names once, in order', () => {
    expect(declaredNames(config)).toEqual(['SUPABASE_URL', 'DB_URL', 'SENTRY_DSN']);
    expect(declaredNames({ packs: [] })).toEqual([]);
  });

  it('takes the ambient and pointer names from the declared packs only', () => {
    expect(ambientNames(config)).toEqual(['SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGOPTIONS']);
    expect(pointerNames(config)).toEqual(['PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGOPTIONS']);
    expect([ambientNames({ packs: ['expo'] }), pointerNames({ packs: [] })]).toEqual([[], []]);
  });
});

describe('targets and files', () => {
  it('finds a declared target and nothing else', () => {
    expect(targetOf(config, 'dev')).toBe(config.secrets.targets.dev);
    for (const name of ['staging', 'toString', '__proto__']) expect(targetOf(config, name)).toBeNull();
    expect(targetOf({ packs: [] }, 'dev')).toBeNull();
  });

  it('names a keychain service per repo by its id (disposition 52)', () => {
    expect(serviceOf(config, 'dev')).toBe('cookwright/my-app/dev');
    expect(serviceOf({ secrets: { id: 'other-app' } }, 'dev')).not.toBe(serviceOf(config, 'dev'));
  });

  it('keeps the files under secrets/ at the config root', () => {
    expect([RECIPIENTS, templateOf('dev'), ciphertextOf('prod-eu')]).toEqual([
      'secrets/recipients.txt',
      'secrets/dev.env.tpl',
      'secrets/prod-eu.env.age',
    ]);
  });

  it('names a path under the config root relative to the top, never one outside it (disposition 54)', () => {
    const top = path.join(path.sep, 'w', 'repo');
    expect(topRel(top, top, RECIPIENTS)).toBe('secrets/recipients.txt');
    expect(topRel(path.join(top, 'apps', 'mobile'), top, RECIPIENTS)).toBe('apps/mobile/secrets/recipients.txt');
    expect(topRel(path.join(path.sep, 'w', 'elsewhere'), top, RECIPIENTS)).toBeNull();
    expect(topRel(top, top, '.')).toBeNull();
  });
});

describe('splitArgv (disposition 1)', () => {
  it('splits at the first --, the child’s argv verbatim, flags and later -- included', () => {
    expect(splitArgv(['dev', '--', 'psql', '--no-psqlrc', '-c', 'select 1', '--', 'x'])).toEqual({
      own: ['dev'],
      child: ['psql', '--no-psqlrc', '-c', 'select 1', '--', 'x'],
    });
    expect(splitArgv(['dev', '--verbose', '--', 'true'])).toEqual({ own: ['dev', '--verbose'], child: ['true'] });
  });

  it('says when there is no -- (null) and when nothing follows it (empty)', () => {
    expect(splitArgv(['dev', 'true'])).toEqual({ own: ['dev', 'true'], child: null });
    expect(splitArgv(['dev', '--'])).toEqual({ own: ['dev'], child: [] });
    expect(splitArgv([])).toEqual({ own: [], child: null });
  });
});
