// src/lib/secret/redact.test.mjs — the redactor: which forms are needles, every
// occurrence covered on bytes, and streaming that equals the whole-buffer answer
// for any chunking, holding back only a needle's prefix (stage-5 plan §4.5).
//
// No test prints a value: assertions compare bytes and lengths.

import crypto from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it } from 'vitest';

import { MIN_INHERITED, Redactor, needles, redactBytes, redactStep } from './redact.mjs';

const B = (s) => Buffer.from(s);
const map = (o) => new Map(Object.entries(o));
const texts = (list) => list.map(([n, r]) => [n.toString(), r.toString()]);
const red = (input, values, inherited) => redactBytes(Buffer.from(input), needles(map(values), inherited)).toString();

/** Feed `chunks` through a Redactor; the output, and what was out after each write. */
async function stream(list, chunks) {
  const r = new Redactor(list);
  const seen = [];
  const out = [];
  r.on('data', (d) => out.push(d));
  for (const c of chunks) {
    r.write(c);
    await new Promise((resolve) => setImmediate(resolve));
    seen.push(Buffer.concat(out).length);
  }
  r.end();
  await new Promise((resolve) => r.on('end', resolve));
  return { out: Buffer.concat(out), seen };
}

describe('needles', () => {
  it('covers each value and its encoded form, longest first, and drops empties and duplicates', () => {
    const list = needles(map({ A: 'a b/c', B: 'short', E: '', DUP: 'short' }));
    expect(texts(list)).toEqual([
      ['a%20b%2Fc', '<A>'],
      ['a b/c', '<A>'],
      ['short', '<B>'],
    ]);
  });

  it('adds a URL password of 8 or more characters as written, decoded and encoded, and not a shorter one', () => {
    const long = 'postgresql://postgres.ref:p%40ss-w0rd!@db.example:5432/postgres';
    const forms = texts(needles(map({ DB_URL: long }))).map(([n]) => n);
    expect(forms).toEqual(expect.arrayContaining(['p%40ss-w0rd!', 'p@ss-w0rd!', encodeURIComponent('p@ss-w0rd!')]));
    const short = 'postgresql://u:pw@db.example/x';
    expect(texts(needles(map({ DB_URL: short }))).map(([n]) => n)).not.toContain('pw');
    // a user without a password, or something that is not a userinfo, adds nothing
    expect(needles(map({ U: 'https://user@example.com/path' }))).toHaveLength(2);
    expect(needles(map({ U: 'https://example.com/a:verylongvalue@b' }))).toHaveLength(2);
  });

  it('leaves out the password of a URL publicUrl calls public, the whole value staying a needle', () => {
    const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    const isLocal = (v) => v === local;
    expect(texts(needles(map({ DB_URL: local }), [], isLocal)).map(([n]) => n)).toEqual([encodeURIComponent(local), local]);
    expect(texts(needles(map({ DB_URL: local }))).map(([n]) => n)).toContain('postgres');
  });

  it('takes an inherited value only from 8 characters (disposition 68), the resolved one winning', () => {
    const inherited = [
      ['DB_URL', 'x'.repeat(MIN_INHERITED - 1)],
      ['SUPABASE_DB_URL', 'y'.repeat(MIN_INHERITED)],
      ['OTHER', 'resolved-value'],
    ];
    const list = texts(needles(map({ KEY: 'resolved-value', SHORT: 'k' }), inherited));
    expect(list).toEqual([
      ['resolved-value', '<KEY>'],
      ['yyyyyyyy', '<SUPABASE_DB_URL>'],
      ['k', '<SHORT>'],
    ]);
  });
});

describe('redactBytes', () => {
  it('replaces every occurrence, a short declared value included', () => {
    expect(red('k=VALUE1;k=VALUE1;', { K: 'VALUE1' })).toBe('k=<K>;k=<K>;');
    expect(red('a1b1', { ONE: '1' })).toBe('a<ONE>b<ONE>');
  });

  it('prefers the longest needle, and covers a password inside its own URL once', () => {
    const url = 'postgresql://postgres.ref:longpassword@db.example/postgres';
    expect(red(`url ${url} pw longpassword`, { DB_URL: url })).toBe('url <DB_URL> pw <DB_URL>');
    expect(red('abcdef', { SHORT: 'abc', LONG: 'abcdef' })).toBe('<LONG>');
  });

  it('covers overlapping values whole, naming both', () => {
    expect(red('xxabcdefghiyy', { A: 'abcdef', B: 'defghi' })).toBe('xx<A><B>yy');
    expect(red('aaaa', { A: 'aaa' })).toBe('<A>');
  });

  it('covers the encoded form', () => {
    expect(red(`q=${encodeURIComponent('s3cr3t value/x')}`, { S: 's3cr3t value/x' })).toBe('q=<S>');
  });

  it('passes bytes no needle covers unchanged: invalid UTF-8 and random binary', () => {
    const bad = Buffer.from([0xff, 0xfe, 0x80, 0x41, 0xc3]);
    const list = needles(map({ K: 'secret-value' }));
    expect(redactBytes(bad, list).equals(bad)).toBe(true);
    const bin = crypto.randomBytes(65536);
    expect(redactBytes(bin, list).equals(bin)).toBe(true);
    const value = 'pässwörd-ünïcode';
    const out = redactBytes(Buffer.concat([bad, B(value), bad]), needles(map({ K: value })));
    expect(out.equals(Buffer.concat([bad, B('<K>'), bad]))).toBe(true);
  });

  it('returns the input with no needles at all', () => {
    const buf = B('anything');
    expect(redactBytes(buf, [])).toBe(buf);
  });
});

describe('streaming', () => {
  const list = needles(map({ DB_URL: 'postgresql://u:longpassword@db.example/x', KEY: 'eyJhbGciOi.payload.sig' }));

  it('writes a prompt with no newline at once, holding nothing that is no needle’s prefix', async () => {
    const { out, seen } = await stream(list, [B('Password: ')]);
    expect(seen).toEqual([10]);
    expect(out.toString()).toBe('Password: ');
  });

  it('redacts a value split across two chunks, holding only its prefix meanwhile', async () => {
    const { out, seen } = await stream(list, [B('key=eyJhbG'), B('ciOi.payload.sig\n')]);
    expect(seen[0]).toBe(4); // 'key=' out, the prefix held
    expect(out.toString()).toBe('key=<KEY>\n');
  });

  it('releases a held prefix as soon as a byte breaks it', async () => {
    const { out, seen } = await stream(list, [B('x eyJ'), B('Z')]);
    expect(seen).toEqual([2, 6]);
    expect(out.toString()).toBe('x eyJZ');
  });

  it('releases a held prefix at end(), unredacted since it is no value', async () => {
    const { out } = await stream(list, [B('tail eyJhbGci')]);
    expect(out.toString()).toBe('tail eyJhbGci');
  });

  it('splits a multibyte value at every byte and still redacts it', async () => {
    const value = 'clé-secrète-日本';
    const l = needles(map({ V: value }));
    const bytes = B(`<${value}>`);
    for (let cut = 1; cut < bytes.length; cut += 1) {
      const { out } = await stream(l, [bytes.subarray(0, cut), bytes.subarray(cut)]);
      expect([cut, out.toString()]).toEqual([cut, '<<V>>']);
    }
  });

  it('equals the whole-buffer answer for any chunking (seeded)', async () => {
    let seed = 42;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const values = { A: 'abcabd', B: 'cabdx', C: 'zz', D: 'abcabcabd' };
    const l = needles(map(values));
    const alphabet = 'abcdxz';
    for (let round = 0; round < 200; round += 1) {
      const input = B(Array.from({ length: 40 }, () => alphabet[rand(alphabet.length)]).join(''));
      const chunks = [];
      for (let i = 0; i < input.length; ) {
        const n = 1 + rand(7);
        chunks.push(input.subarray(i, i + n));
        i += n;
      }
      const { out } = await stream(l, chunks);
      expect([input.toString(), out.toString()]).toEqual([input.toString(), redactBytes(input, l).toString()]);
    }
  });

  it('holds back no more than a needle’s prefix: redactStep’s rest', () => {
    const l = needles(map({ K: 'secret' }));
    expect(redactStep(B('abc secr'), l).rest.toString()).toBe('secr');
    expect(redactStep(B('abc secret'), l).out.toString()).toBe('abc <K>');
    // a complete value that is also the prefix of a longer one waits for the longer one
    const two = needles(map({ A: 'secret', B: 'secret-longer' }));
    const step = redactStep(B('x secret'), two);
    expect([step.out.toString(), step.rest.toString()]).toEqual(['x ', 'secret']);
  });

  it('passes 4 MiB of random binary byte-identical through a slow consumer', async () => {
    const input = crypto.randomBytes(4 * 1024 * 1024);
    const source = new PassThrough();
    const got = [];
    const slow = new Writable({
      highWaterMark: 1024,
      write(chunk, _e, done) {
        got.push(chunk);
        setImmediate(done);
      },
    });
    const done = pipeline(source, new Redactor(list), slow);
    for (let i = 0; i < input.length; i += 65536) source.write(input.subarray(i, i + 65536));
    source.end();
    await done;
    expect(Buffer.concat(got).equals(input)).toBe(true);
  });
});
