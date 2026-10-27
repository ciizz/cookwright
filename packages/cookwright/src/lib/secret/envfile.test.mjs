// src/lib/secret/envfile.test.mjs — resolved text read against the expected names,
// and one line replaced (stage-5 plan disposition 53). The values are synthetic.

import { describe, expect, it } from 'vitest';

import { messages } from '../messages.mjs';
import { parseAgainst, replaceLine } from './envfile.mjs';

const NAMES = ['SUPABASE_URL', 'DB_URL', 'KEY'];
const TEXT = 'SUPABASE_URL=https://x.example\nDB_URL=postgresql://u:p@h/d\nKEY= spaced value \n';
const why = (text, expected = NAMES, opts) => parseAgainst(text, expected, opts).problem;
const render = (p) => messages.secrets.envfile[p.why](p);

describe('parseAgainst, any order', () => {
  it('reads each declared name once, in the order given, values untrimmed', () => {
    const { values } = parseAgainst('KEY= spaced value \nDB_URL=a=b\nSUPABASE_URL=u', NAMES);
    expect([...values]).toEqual([
      ['KEY', ' spaced value '],
      ['DB_URL', 'a=b'],
      ['SUPABASE_URL', 'u'],
    ]);
  });

  it('refuses an empty or absent declared name as missing, unless partial', () => {
    expect(why('SUPABASE_URL=u\nDB_URL=\nKEY=k\n')).toEqual({ why: 'missing', name: 'DB_URL' });
    expect(why('SUPABASE_URL=u\nKEY=k\n')).toEqual({ why: 'missing', name: 'DB_URL' });
    expect([...parseAgainst('KEY=k\n', NAMES, { partial: true }).values]).toEqual([['KEY', 'k']]);
    expect(parseAgainst('', NAMES, { partial: true }).values.size).toBe(0);
    expect(why('KEY=\n', NAMES, { partial: true })).toEqual({ why: 'missing', name: 'KEY' });
  });

  it('refuses a continuation shaped LD_PRELOAD=x by its line number alone', () => {
    const p = why(`${TEXT}LD_PRELOAD=x\n`);
    expect(p).toEqual({ why: 'unknown', line: 4 });
    expect(render(p)).not.toContain('LD_PRELOAD');
  });

  it('refuses a duplicate, a malformed line, a blank line, a CR and a NUL', () => {
    expect(why(`${TEXT}KEY=again\n`)).toEqual({ why: 'duplicate', name: 'KEY' });
    expect(why('SUPABASE_URL=u\nnot a line\n')).toEqual({ why: 'malformed', line: 2 });
    expect(why('SUPABASE_URL=u\n\nDB_URL=d\nKEY=k\n')).toEqual({ why: 'malformed', line: 2 });
    expect(why('SUPABASE_URL=u\r\nDB_URL=d\r\nKEY=k\r\n')).toEqual({ why: 'malformed', line: 1 });
    expect(why('SUPABASE_URL=u\nDB_URL=d\0x\nKEY=k\n')).toEqual({ why: 'nul', line: 2 });
    expect(why('db_url=x\n', ['DB_URL'])).toEqual({ why: 'malformed', line: 1 });
  });
});

describe('parseAgainst, ordered (a 1Password template)', () => {
  it('reads exactly one line per reference, in order', () => {
    expect([...parseAgainst(TEXT, NAMES, { ordered: true }).values.keys()]).toEqual(NAMES);
  });

  it('refuses a wrong order, an extra line (a value spanning lines) and a missing line', () => {
    expect(why('DB_URL=d\nSUPABASE_URL=u\nKEY=k\n', NAMES, { ordered: true })).toEqual({ why: 'unexpected', line: 1, name: 'SUPABASE_URL' });
    expect(why(`${TEXT}more of the key\n`, NAMES, { ordered: true })).toEqual({ why: 'extra', line: 4 });
    expect(why('SUPABASE_URL=u\nDB_URL=line one\nline two\nKEY=k\n', NAMES, { ordered: true })).toEqual({ why: 'malformed', line: 3 });
    expect(why('SUPABASE_URL=u\nDB_URL=d\n', NAMES, { ordered: true })).toEqual({ why: 'missing', name: 'KEY' });
  });
});

describe('the problem lines', () => {
  it('name a line number or a declared name, never a line’s text', () => {
    const lines = [
      [{ why: 'nul', line: 2 }, 'line 2 of the resolved text holds a NUL byte'],
      [{ why: 'malformed', line: 3 }, 'line 3 of the resolved text is not NAME=value'],
      [{ why: 'extra', line: 4 }, 'line 4 of the resolved text matches no template reference (a value spanning lines?)'],
      [{ why: 'unexpected', line: 1, name: 'A' }, "line 1 of the resolved text is not A, the template's line there"],
      [{ why: 'unknown', line: 5 }, 'line 5 of the resolved text sets a name the target does not declare'],
      [{ why: 'duplicate', name: 'KEY' }, 'KEY is set twice in the resolved text'],
      [{ why: 'missing', name: 'DB_URL' }, 'DB_URL is missing or empty'],
    ];
    for (const [p, line] of lines) expect(render(p)).toBe(line);
  });
});

describe('replaceLine', () => {
  it('replaces a line in place, appends a new one, and always ends in a newline', () => {
    expect(replaceLine(TEXT, 'DB_URL', 'new')).toBe('SUPABASE_URL=https://x.example\nDB_URL=new\nKEY= spaced value \n');
    expect(replaceLine('A=1', 'B', '2')).toBe('A=1\nB=2\n');
    expect(replaceLine('', 'A', '1')).toBe('A=1\n');
    expect(replaceLine('AB=1\nA=2\n', 'A', '3')).toBe('AB=1\nA=3\n'); // a name that prefixes another is not that one
  });

  it('round-trips through parseAgainst', () => {
    let text = '';
    for (const [n, v] of [['KEY', 'k=1 '], ['DB_URL', 'd'], ['KEY', 'k2']]) text = replaceLine(text, n, v);
    expect([...parseAgainst(text, ['KEY', 'DB_URL']).values]).toEqual([
      ['KEY', 'k2'],
      ['DB_URL', 'd'],
    ]);
  });

  it('throws on a value of more than one line or with a NUL, naming the secret only', () => {
    for (const v of ['a\nb', 'a\rb', 'a\0b']) expect(() => replaceLine('', 'KEY', v)).toThrow(new RangeError('KEY: a value is one line, with no NUL byte'));
  });
});
