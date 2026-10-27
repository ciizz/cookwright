// src/lib/secret/engine.test.mjs — the engine's pure steps (stage-5 plan §4.2): the
// backend and target lookups, the two environments, the needles of inherited
// values, the argv check with its loopback exemption, the banner. `run` end to end
// is in src/run.test.mjs. Values are synthetic; nothing prints one.

import { describe, expect, it } from 'vitest';

import { messages } from '../messages.mjs';
import { controlNames } from './config.mjs';
import {
  Refused,
  argvCheck,
  banner,
  childEnv,
  helperEnv,
  inheritedValues,
  isLoopback,
  openBackend,
  openTarget,
  passwordUrl,
  scrubNames,
} from './engine.mjs';
import { needles } from './redact.mjs';

const REF = 'abcdefghijklmnopqrst';
const DB_URL = `postgresql://postgres.${REF}:s3cret-pass-word@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`;
const config = {
  packs: ['supabase'],
  secrets: {
    backend: 'age',
    targets: {
      dev: { names: ['SUPABASE_URL', 'DB_URL'], proof: { kind: 'supabase', ref: REF } },
      ops: { names: ['API_TOKEN'] },
    },
  },
};
const backend = { name: 'age', tools: { resolve: ['age'], init: ['age', 'age-keygen'] }, install: 'get age', control: ['ID', 'OP_SESSION_*'] };

const refusal = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(Refused);
    return err.message;
  }
  throw new Error('no refusal');
};

describe('openBackend and openTarget', () => {
  const io = (over = {}) => ({ backends: { age: backend }, probes: { hasTool: () => true }, platform: 'linux', env: {}, ...over });

  it('refuses no secrets key, an unknown target naming the declared ones, and a backend not shipped', () => {
    expect(refusal(() => openTarget({}, 'dev'))).toBe(messages.secrets.none);
    expect(refusal(() => openBackend({}, io(), 'resolve'))).toBe(messages.secrets.none);
    expect(refusal(() => openTarget(config, 'prod'))).toBe('no target prod in cookwright.json (declared: dev, ops)');
    expect(refusal(() => openBackend(config, io({ backends: {} }), 'resolve'))).toBe(messages.secrets.noBackend('age'));
    expect(openTarget(config, 'dev')).toBe(config.secrets.targets.dev);
  });

  it("names the operation's missing tool with the install line, and a wrong platform", () => {
    const hasTool = (bin) => bin === 'age';
    expect(openBackend(config, io({ probes: { hasTool } }), 'resolve')).toBe(backend);
    expect(refusal(() => openBackend(config, io({ probes: { hasTool } }), 'init'))).toBe('needs age-keygen: get age');
    const darwin = { ...backend, platforms: ['darwin'] };
    expect(refusal(() => openBackend(config, io({ backends: { age: darwin } }), 'resolve'))).toBe(
      'the age backend runs on darwin only',
    );
  });
});

describe('the two environments', () => {
  const env = {
    PATH: '/bin',
    DB_URL: 'stale',
    API_TOKEN: 'other-target',
    SUPABASE_DB_URL: 'ambient',
    PGHOST: 'prod.example',
    ID: '/id.age',
    OP_SESSION_me: 'session',
    COPY: DB_URL,
    KEEP: 'kept',
  };
  const values = new Map([
    ['SUPABASE_URL', `https://${REF}.supabase.co`],
    ['DB_URL', DB_URL],
  ]);

  it('gives every helper the environment without any declared or ambient name, control names kept', () => {
    const helper = helperEnv(env, scrubNames(config));
    expect(Object.keys(helper).sort()).toEqual(['COPY', 'ID', 'KEEP', 'OP_SESSION_me', 'PATH']);
  });

  it('gives the child the values, without control, libpq or value-equal names, and names each dropped', () => {
    const drop = [...scrubNames(config), ...controlNames(backend, env)];
    const out = childEnv(env, drop, values);
    expect(Object.keys(out.env).sort()).toEqual(['DB_URL', 'KEEP', 'PATH', 'SUPABASE_URL']);
    expect(out.env.DB_URL.length).toBe(DB_URL.length);
    expect(out.dropped).toEqual(['API_TOKEN', 'COPY', 'DB_URL', 'ID', 'OP_SESSION_me', 'PGHOST', 'SUPABASE_DB_URL']);
  });

  it("drops libpq's names whatever the packs when a value is a postgres URL, and only then", () => {
    const bare = { secrets: { backend: 'age', targets: { dev: { names: ['DB_URL'] } } } };
    const withPg = childEnv({ PGHOSTADDR: '10.0.0.1', PGPASSWORD: 'p' }, scrubNames(bare), new Map([['DB_URL', DB_URL]]));
    expect(withPg.dropped).toEqual(['PGHOSTADDR', 'PGPASSWORD']);
    const plain = childEnv({ PGHOSTADDR: '10.0.0.1' }, scrubNames(bare), new Map([['DB_URL', 'https://x.example']]));
    expect(plain.env.PGHOSTADDR).toBe('10.0.0.1');
  });

  it('matches control names exactly or by a trailing-star prefix', () => {
    expect(controlNames(backend, { ID: '1', IDX: '2', OP_SESSION_a: '3', OP_SESSIONS: '4' })).toEqual(['ID', 'OP_SESSION_a']);
    expect(controlNames({}, { ID: '1' })).toEqual([]);
  });
});

describe('inheritedValues', () => {
  it('reads declared and ambient names, never a pointer, and PGPASSWORD only among libpq names', () => {
    const env = { DB_URL: 'stale-value-1', SUPABASE_ACCESS_TOKEN: 'tok', PGSERVICE: 'svc', PGPASSWORD: 'pw', HOME: '/h' };
    const got = inheritedValues(env, config, []);
    expect(got.map(([n]) => n).sort()).toEqual(['DB_URL', 'PGPASSWORD', 'SUPABASE_ACCESS_TOKEN']);
    const bare = { secrets: { backend: 'age', targets: { dev: { names: ['DB_URL'] } } } };
    const libpq = ['PGHOST', 'PGPASSWORD'];
    expect(inheritedValues({ PGHOST: 'h', PGPASSWORD: 'pw' }, bare, libpq).map(([n]) => n)).toEqual(['PGPASSWORD']);
  });
});

describe('the argv check', () => {
  const values = new Map([['DB_URL', DB_URL], ['TOKEN', 'abc/def ghi']]);
  const list = needles(values, [['SUPABASE_DB_URL', 'postgresql://postgres:old-prod-pass@prod.example/db'], ['PGPASSWORD', 'short']]);

  it('refuses a value, its encoded form, a URL password and an inherited value, naming the position', () => {
    expect(refusal(() => argvCheck(['psql', DB_URL], list))).toBe(messages.run.argValue(2, 'DB_URL'));
    expect(refusal(() => argvCheck(['curl', '-d', `t=${encodeURIComponent('abc/def ghi')}`], list))).toBe(
      messages.run.argValue(3, 'TOKEN'),
    );
    expect(refusal(() => argvCheck(['x', 'PGPASSWORD=s3cret-pass-word'], list))).toBe(messages.run.argValue(2, 'DB_URL'));
    expect(refusal(() => argvCheck(['psql', 'postgresql://postgres:old-prod-pass@prod.example/db'], list))).toMatch(
      /^argument 2 holds the value of SUPABASE_DB_URL;/,
    );
  });

  it('passes a short inherited value, and the command itself is argument 1', () => {
    expect(() => argvCheck(['echo', 'short'], list)).not.toThrow();
    expect(refusal(() => argvCheck(['abc/def ghi'], list))).toBe(messages.run.argValue(1, 'TOKEN'));
  });

  it('refuses any URL with a password, loopback hosts excepted', () => {
    expect(refusal(() => argvCheck(['psql', 'postgres://u:pw@db.example.com/x'], list))).toBe(messages.run.argUrl(2));
    expect(refusal(() => argvCheck(['x', '--url=https://u:p@[2001:db8::1]:8080/'], list))).toBe(messages.run.argUrl(2));
    for (const ok of [
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      'postgres://postgres:postgres@localhost/postgres',
      'redis://u:p@[::1]:6379',
      'http://u:p@host.docker.internal:8080/x',
      'https://user@example.com/x',
      'https://u:@example.com/x',
      'http://localhost:3000/?email=a@b.example',
    ]) {
      expect([ok, passwordUrl(ok)]).toEqual([ok, false]);
    }
    expect(isLoopback('127.1.2.3:5432')).toBe(true);
    expect(isLoopback('127.0.0.1.evil.example')).toBe(false);
    expect(isLoopback('localhost.evil.example')).toBe(false);
  });
});

describe('banner', () => {
  it('names the injected, proved, unproved, dropped and uncommitted, absent parts left out', () => {
    const proof = { ok: true, proved: ['SUPABASE_URL', 'DB_URL'], against: REF, kind: 'supabase' };
    const names = ['SUPABASE_URL', 'DB_URL', 'SERVICE_ROLE_KEY'];
    expect(banner({ target: 'dev', names, proof, dropped: ['DB_URL', 'SUPABASE_DB_URL'], uncommitted: ['cookwright.json'] })).toBe(
      `run: dev · injected SUPABASE_URL, DB_URL, SERVICE_ROLE_KEY · proved SUPABASE_URL, DB_URL against ${REF} (supabase)` +
        ' · unproved SERVICE_ROLE_KEY · dropped from the environment: DB_URL, SUPABASE_DB_URL · uncommitted: cookwright.json' +
        ' · child output piped through the redactor (no terminal on stdout/stderr)',
    );
    const none = { ok: true, proved: [], against: null, kind: null };
    expect(banner({ target: 'ops', names: ['API_TOKEN'], proof: none, dropped: [], uncommitted: null })).toBe(
      'run: ops · injected API_TOKEN · unproved API_TOKEN · uncommitted: not measured (git status failed)' +
        ' · child output piped through the redactor (no terminal on stdout/stderr)',
    );
  });
});
