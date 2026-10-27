// src/lib/secret/backends/keychain.test.mjs — the keychain backend (stage-5 plan
// §4.3, §6 "Backends", dispositions 12, 26, 52, 60): with a fake `security` the
// argument shapes, the service per repo, the value never on a command line, the
// `security -i` line and its limit, the read-back; then, on macOS, the real
// `security` against a throwaway keychain in a scratch directory (created and
// unlocked with a throwaway password, deleted after), through the `keychain`
// argument the product never passes. No login keychain is touched: the last test
// asks the default search list for the service and finds nothing. Values are
// synthetic.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { messages } from '../../messages.mjs';
import { PROBES, hasTool } from '../../probes.mjs';
import { scratchRoot } from '../../../test-helpers.mjs';
import { Refused, openBackend } from '../engine.mjs';
import { KEYCHAIN, LINE_MAX, addLine, inspect, passwordOf, quoted, resolve, set } from './keychain.mjs';

const TMP = scratchRoot('cookwright-keychain-');
const k = messages.secrets.keychain;
const t = messages.doctor.secretsTargets;
const NAMES = ['DB_URL', 'TOKEN'];
const config = (id = 'app') => ({ secrets: { backend: 'keychain', id, targets: { dev: { names: NAMES } } } });
const SERVICE = 'cookwright/app/dev';

/** The words of a `security -i` line, read as measured: double quotes, `\` escaping inside them. */
function words(line) {
  const out = [];
  for (const [, quotedWord, bare] of line.trim().matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    out.push(quotedWord === undefined ? bare : quotedWord.replace(/\\(.)/g, '$1'));
  }
  return out;
}

/** `-g`'s password line for `value`, raw when printable ASCII, else hex as security prints it. */
const gLine = (value) =>
  /^[\x20-\x7e]*$/.test(value) ? `password: "${value}"\n` : `password: 0x${Buffer.from(value).toString('hex').toUpperCase()}  "…"\n`;

/** A fake security over a Map `service|account → value`; every call recorded. */
function fakeSecurity({ store = new Map(), lookupStatus, mangle = (v) => v } = {}) {
  const calls = [];
  const capture = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input, env: opts.env });
    const at = (flag) => args[args.indexOf(flag) + 1];
    if (args[0] === '-i') {
      const w = words(opts.input);
      store.set(`${w[w.indexOf('-s') + 1]}|${w[w.indexOf('-a') + 1]}`, mangle(w[w.indexOf('-w') + 1]));
      return { status: 0, stdout: '', stderr: '' };
    }
    const key = `${at('-s')}|${at('-a')}`;
    if (args[0] === 'delete-generic-password') return { status: store.delete(key) ? 0 : 44, stdout: '', stderr: '' };
    if (lookupStatus) return { status: lookupStatus, stdout: '', stderr: 'security: a line naming the item' };
    if (!store.has(key)) return { status: 44, stdout: '', stderr: 'security: SecKeychainSearchCopyNext: not found\n' };
    return { status: 0, stdout: 'keychain: "x"\n', stderr: args.includes('-g') ? gLine(store.get(key)) : '' };
  };
  return { capture, calls, store };
}

const ctxOf = (fake, over = {}) => ({
  config: config(),
  probes: { ...PROBES, capture: fake.capture },
  env: { PATH: '/usr/bin', HOME: TMP },
  readValue: async () => 'v4lue',
  ...over,
});

const refusal = async (fn) => {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(Refused);
    return err.message;
  }
  throw new Error('no refusal');
};

describe('passwordOf: the -g line (measured)', () => {
  it('reads a raw value as it is, inner quotes included, and an empty one as empty', () => {
    expect(passwordOf('keychain: "x"\npassword: "plain"\n')).toEqual({ value: 'plain' });
    expect(passwordOf('password: "a"b""\n')).toEqual({ value: 'a"b"' });
    expect(passwordOf('password: "0xAB"\n')).toEqual({ value: '0xAB' });
    expect(passwordOf('password: \n')).toEqual({ value: '' });
    expect(passwordOf('no such line\n')).toBeNull();
  });

  it('decodes the hex form, so a value of hex digits never reads as another', () => {
    expect(passwordOf('password: 0x70C3A4737377C3B672642D  "p\\303\\244ssw\\303\\266rd-"\n')).toEqual({ value: 'pässwörd-' });
    expect(passwordOf('password: 0x610962  "a\\011b"\n')).toEqual({ value: 'a\tb' });
    expect(passwordOf('password: 0xFF  "\\377"\n')).toEqual({ why: 'notText' });
  });
});

describe('the security -i line (disposition 60)', () => {
  it('quotes each word, escaping only \\ and "', () => {
    expect(quoted('a"b\\c\'d $e')).toBe('"a\\"b\\\\c\'d $e"');
    const line = addLine(SERVICE, 'DB_URL', 'x y"z\\', '/k/a b.keychain-db');
    expect(line).toBe('add-generic-password -U -s "cookwright/app/dev" -a DB_URL -w "x y\\"z\\\\" "/k/a b.keychain-db"\n');
    expect(words(line)).toEqual(['add-generic-password', '-U', '-s', SERVICE, '-a', 'DB_URL', '-w', 'x y"z\\', '/k/a b.keychain-db']);
  });
});

describe('resolve and inspect with a fake security', () => {
  it('reads each name with -g under the per-repo service, with the scrubbed environment', () => {
    const fake = fakeSecurity({ store: new Map([[`${SERVICE}|DB_URL`, 'postgres://u@h/d'], [`${SERVICE}|TOKEN`, 'tök\tn']]) });
    const ctx = ctxOf(fake);
    expect(Object.fromEntries(resolve('dev', ctx))).toEqual({ DB_URL: 'postgres://u@h/d', TOKEN: 'tök\tn' });
    expect(fake.calls.map((c) => c.args)).toEqual([
      ['find-generic-password', '-s', SERVICE, '-a', 'DB_URL', '-g'],
      ['find-generic-password', '-s', SERVICE, '-a', 'TOKEN', '-g'],
    ]);
    expect(fake.calls.every((c) => c.env === ctx.env)).toBe(true);
  });

  it("refuses a missing or empty item naming the set line, and another exit without security's output", async () => {
    const fake = fakeSecurity({ store: new Map([[`${SERVICE}|DB_URL`, '']]) });
    expect(await refusal(() => resolve('dev', ctxOf(fake)))).toBe(messages.secrets.missingName('DB_URL', 'dev'));
    const locked = fakeSecurity({ lookupStatus: 51 });
    const msg = await refusal(() => resolve('dev', ctxOf(locked)));
    expect(msg).toBe(k.failed('find-generic-password', 51));
    expect(msg).not.toContain('naming the item');
  });

  it('never lets two repos with different ids share an item (disposition 52)', async () => {
    const fake = fakeSecurity();
    await set('dev', 'DB_URL', ctxOf(fake, { config: config('app-a') }));
    expect([...fake.store.keys()]).toEqual(['cookwright/app-a/dev|DB_URL']);
    expect(await refusal(() => resolve('dev', ctxOf(fake, { config: config('app-b') })))).toBe(
      messages.secrets.missingName('DB_URL', 'dev'),
    );
  });

  it('inspects by attributes only (no -g, no -w): present, missing, or not measured', () => {
    const both = fakeSecurity({ store: new Map([[`${SERVICE}|DB_URL`, 'a'], [`${SERVICE}|TOKEN`, 'b']]) });
    expect(inspect('dev', ctxOf(both))).toEqual({ status: 'PASS', note: t.keychain.ok('dev', SERVICE) });
    expect(both.calls.map((c) => c.args)).toEqual([
      ['find-generic-password', '-s', SERVICE, '-a', 'DB_URL'],
      ['find-generic-password', '-s', SERVICE, '-a', 'TOKEN'],
    ]);
    const one = fakeSecurity({ store: new Map([[`${SERVICE}|DB_URL`, 'a']]) });
    expect(inspect('dev', ctxOf(one))).toEqual({ status: 'WARN', note: t.keychain.missing('dev', SERVICE, ['TOKEN']) });
    expect(inspect('dev', ctxOf(fakeSecurity({ lookupStatus: 36 })))).toEqual({
      status: 'SKIP',
      note: t.keychain.lookup('dev', 36),
    });
  });
});

describe('set with a fake security', () => {
  it('writes through security -i on stdin, never in an argument, then reads it back', async () => {
    const fake = fakeSecurity();
    const value = 'pw with "quotes", \\ and spaces';
    expect(await set('dev', 'DB_URL', ctxOf(fake, { readValue: async () => value }))).toEqual({ service: SERVICE });
    expect(fake.calls.map((c) => c.args)).toEqual([['-i'], ['find-generic-password', '-s', SERVICE, '-a', 'DB_URL', '-g']]);
    expect(fake.calls[0].input).toBe(addLine(SERVICE, 'DB_URL', value));
    expect(fake.calls.some((c) => c.args.some((a) => a.includes('quotes')))).toBe(false);
    expect(fake.store.get(`${SERVICE}|DB_URL`)).toBe(value);
  });

  it('refuses an undeclared name before asking, and a line past the limit before security runs', async () => {
    let asked = false;
    const fake = fakeSecurity();
    const undeclared = ctxOf(fake, { readValue: async () => { asked = true; return 'v'; } });
    expect(await refusal(() => set('dev', 'OTHER', undeclared))).toBe(messages.secrets.undeclared('OTHER', 'dev'));
    expect(asked).toBe(false);
    const room = LINE_MAX - Buffer.byteLength(addLine(SERVICE, 'DB_URL', ''));
    const long = ctxOf(fake, { readValue: async () => 'x'.repeat(room + 1) });
    expect(await refusal(() => set('dev', 'DB_URL', long))).toBe(k.tooLong(room));
    await set('dev', 'DB_URL', ctxOf(fake, { readValue: async () => 'x'.repeat(room) }));
    expect(fake.calls.filter((c) => c.args[0] === '-i')).toHaveLength(1);
  });

  it('removes an item that does not read back as entered, and refuses', async () => {
    const fake = fakeSecurity({ mangle: (v) => v.slice(0, 3) });
    expect(await refusal(() => set('dev', 'DB_URL', ctxOf(fake)))).toBe(k.readBack('DB_URL', SERVICE));
    expect(fake.calls.at(-2).args).toEqual(['delete-generic-password', '-s', SERVICE, '-a', 'DB_URL']);
    expect(fake.calls.at(-1).args).toEqual(['find-generic-password', '-s', SERVICE, '-a', 'DB_URL']);
    expect(fake.store.size).toBe(0);
  });

  it('says the mismatched item remains, with the status, when the deletion fails', async () => {
    const fake = fakeSecurity({ mangle: (v) => v.slice(0, 3) });
    const capture = (cmd, args, opts) =>
      args[0] === 'delete-generic-password' ? { status: 51, stdout: '', stderr: '' } : fake.capture(cmd, args, opts);
    const ctx = ctxOf(fake, { probes: { ...PROBES, capture } });
    expect(await refusal(() => set('dev', 'DB_URL', ctx))).toBe(k.readBackKept('DB_URL', SERVICE, 51));
    expect(k.readBackKept('DB_URL', SERVICE, 51)).not.toContain('nothing kept');
    expect(fake.store.size).toBe(1);
  });

  it('refuses init with one line, runs on macOS only, and names its service on the banner', async () => {
    expect(await refusal(() => KEYCHAIN.init({}, {}))).toBe(k.noInit);
    const io = { backends: { keychain: KEYCHAIN }, probes: { hasTool: () => true }, platform: 'linux', env: {} };
    expect(await refusal(() => openBackend(config(), io, 'resolve'))).toBe('the keychain backend runs on darwin only');
    expect(KEYCHAIN.bannerParts('dev', config())).toEqual([`keychain service ${SERVICE}`]);
  });
});

const REAL = process.platform === 'darwin' && hasTool('security');

describe.skipIf(!REAL)('the real security, on a throwaway keychain (disposition 12)', () => {
  const dir = path.join(TMP, 'keychains');
  const keychain = path.join(dir, 'throwaway.keychain-db');
  const id = `t${crypto.randomBytes(6).toString('hex')}`;
  const service = `cookwright/${id}/dev`;
  const sec = (...args) => spawnSync('security', args, { encoding: 'utf8' });
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const ctx = (readValue) => ({
    config: config(id),
    probes: PROBES,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    keychain,
    readValue,
  });

  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    const pw = crypto.randomBytes(12).toString('hex');
    for (const args of [['create-keychain', '-p', pw, keychain], ['unlock-keychain', '-p', pw, keychain], ['set-keychain-settings', keychain]]) {
      expect(sec(...args).status).toBe(0);
    }
    // Test-only: a throwaway value in a throwaway keychain, on the command line.
    expect(sec('add-generic-password', '-s', service, '-a', 'DB_URL', '-w', 'postgres://u:p@h/d', keychain).status).toBe(0);
  }, 30_000);

  afterAll(() => {
    sec('delete-keychain', keychain);
  });

  it('inspects by name, then resolves once every name is there', async () => {
    expect(inspect('dev', ctx())).toEqual({ status: 'WARN', note: t.keychain.missing('dev', service, ['TOKEN']) });
    expect(await refusal(() => resolve('dev', ctx()))).toBe(messages.secrets.missingName('TOKEN', 'dev'));
    await set('dev', 'TOKEN', ctx(async () => 'tok'));
    expect(inspect('dev', ctx())).toEqual({ status: 'PASS', note: t.keychain.ok('dev', service) });
    expect(Object.fromEntries(resolve('dev', ctx()))).toEqual({ DB_URL: 'postgres://u:p@h/d', TOKEN: 'tok' });
  }, 30_000);

  it.each([
    ['220 characters', 'k'.repeat(110) + 'y'.repeat(110)],
    ['spaces, quotes and backslashes', ` a "b" 'c' \\d\\\\ $e \`f\` #g;h `],
    ['non-ASCII and a tab', 'pässwörd-ключ-🔑\tend'],
    ['a value of hex digits', '70c3a4'],
  ])('sets %s through security -i and reads it back whole', async (_what, value) => {
    expect(await set('dev', 'TOKEN', ctx(async () => value))).toEqual({ service });
    expect(sha(resolve('dev', ctx()).get('TOKEN'))).toBe(sha(value));
  }, 30_000);

  it('sets the longest value one line holds, and refuses one byte more with nothing written', async () => {
    const room = LINE_MAX - Buffer.byteLength(addLine(service, 'TOKEN', '', keychain));
    const longest = 'z'.repeat(room);
    await set('dev', 'TOKEN', ctx(async () => longest));
    expect(sha(resolve('dev', ctx()).get('TOKEN'))).toBe(sha(longest));
    expect(await refusal(() => set('dev', 'TOKEN', ctx(async () => `${longest}z`)))).toBe(k.tooLong(room));
    expect(sha(resolve('dev', ctx()).get('TOKEN'))).toBe(sha(longest));
  }, 30_000);

  it('wrote nothing to the default search list (the login keychain)', () => {
    expect(sec('find-generic-password', '-s', service).status).toBe(44);
  });
});
