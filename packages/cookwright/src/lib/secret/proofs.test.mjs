// src/lib/secret/proofs.test.mjs — target proof: the host kind, the supabase kind's
// anchors and its near-miss table, the query-string and user-part rules both kinds
// share, the names a proof covers, and reasons that never carry a value (stage-5
// plan §4.4, dispositions 2, 3, 19, 31 and 65). Every URL here is synthetic.

import { describe, expect, it } from 'vitest';

import { messages } from '../messages.mjs';
import { PACKS } from '../packs/registry.mjs';
import { KINDS, canonicalHost, coveredNames, pgHostProblem, pgQueryProblem, proofKinds, prove } from './proofs.mjs';

const REF = 'abcdefghijklmnopqrst';
const OTHER = 'tsrqponmlkjihgfedcba';
const PW = 'Sup3r-s3cret-pw';
const kinds = proofKinds({ packs: ['supabase'] });
const one = (name, value, proof) => prove(new Map([[name, value]]), { names: [name], ...proof }, kinds);
const host = (value, h) => one('API_URL', value, { kind: 'host', host: h });
const supa = (value, ref = REF) => one('DB_URL', value, { kind: 'supabase', ref });
const pooler = (user, h = 'aws-0-eu-central-1.pooler.supabase.com') => `postgresql://${user}:${PW}@${h}:6543/postgres`;
const direct = (user, ref = REF) => `postgresql://${user}:${PW}@db.${ref}.supabase.co:5432/postgres`;

describe('canonicalHost', () => {
  it('reads a host as new URL does: case, default port, trailing dot, IPv6, IDN', () => {
    expect(canonicalHost('API.Example.COM')).toBe('api.example.com');
    expect(canonicalHost('api.example.com:443')).toBe('api.example.com');
    expect(canonicalHost('db.example.com:5432')).toBe('db.example.com:5432');
    expect(canonicalHost('example.com.')).toBe('example.com');
    expect(canonicalHost('[::1]:5432')).toBe('[::1]:5432');
    expect(canonicalHost('bücher.de')).toBe('xn--bcher-kva.de');
  });

  it('refuses anything that is not a bare host', () => {
    for (const bad of ['', 'https://a.example', 'a.example/x', 'u@a.example', 'a b', '::1', 'a.example:x', '.', null, 7]) {
      expect([bad, canonicalHost(bad)]).toEqual([bad, null]);
    }
  });
});

describe('the host kind', () => {
  it('passes a URL on the declared host, whatever its case, path, trailing dot or default port', () => {
    for (const [value, h] of [
      ['https://api.example.com', 'api.example.com'],
      ['https://API.example.com/v1/rest?x=1', 'api.example.com'],
      ['https://api.example.com:443/', 'api.example.com'],
      ['https://api.example.com:443', 'api.example.com:443'],
      ['http://api.example.com:8080/', 'api.example.com:8080'],
      ['https://api.example.com./', 'api.example.com'],
      ['https://bücher.de/', 'xn--bcher-kva.de'],
      ['https://xn--bcher-kva.de/', 'bücher.de'],
      [`postgresql://u:${PW}@DB.example.com:5432/app?sslmode=require`, 'db.example.com:5432'],
      [`postgresql://u:${PW}@[::1]:5432/app`, '[::1]:5432'],
    ]) {
      expect([value, host(value, h).ok]).toEqual([value, true]);
    }
    expect(host('https://api.example.com', 'api.example.com')).toEqual({
      ok: true,
      proved: ['API_URL'],
      against: 'api.example.com',
      kind: 'host',
    });
  });

  it('refuses another host, another port, an unparsable value and an empty one', () => {
    const cases = [
      ['https://api.example.com.evil.example', 'host'],
      ['https://evil.example/api.example.com', 'host'],
      ['https://api.example.com@evil.example/', 'host'],
      ['https://api.example.com:8443', 'host'],
      ['http://api.example.com:443', 'host'], // 443 is the default port of https only
      ['ftp://api.example.com:443', 'host'],
      [`postgresql://u:${PW}@db.example.com/app`, 'host'], // the port is part of the declared host
      ['not a url', 'notUrl'],
      ['', 'notUrl'],
    ];
    for (const [value, anchor] of cases) {
      const h = value.startsWith('postgresql') ? 'db.example.com:5432' : 'api.example.com';
      expect([value, host(value, h).reason]).toEqual([value, { name: 'API_URL', anchor }]);
    }
  });

  it('refuses a postgres value that lists more than one host, the declared one among them', () => {
    for (const hosts of ['db.example.com:5432,evil.example:5432', 'evil.example:5432,db.example.com:5432', 'db.example.com%2Cevil.example:5432']) {
      expect([hosts, host(`postgresql://u:${PW}@${hosts}/app`, 'db.example.com:5432').reason]).toEqual([hosts, { name: 'API_URL', anchor: 'hostList' }]);
    }
  });

  it('refuses a postgres value whose query string moves the host (disposition 65)', () => {
    const value = `postgresql://u:${PW}@db.example.com:5432/app?host=evil.example`;
    expect(host(value, 'db.example.com:5432').reason).toEqual({ name: 'API_URL', anchor: 'param', param: 'host' });
  });
});

describe('the supabase kind', () => {
  it('passes a project URL, a pooler user of any role, and the direct host', () => {
    for (const value of [
      `https://${REF}.supabase.co`,
      `https://${REF}.supabase.co/`,
      pooler(`postgres.${REF}`),
      pooler(`agent_ro.${REF}`),
      pooler(`postgres.${REF}`, 'aws-1-us-east-1.pooler.supabase.com'),
      direct('postgres'),
      direct(`postgres.${REF}`),
      `${direct('postgres')}?sslmode=require&application_name=app`,
      `postgres://postgres.${REF}:${PW}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres%2E${REF}:${PW}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
      `postgresql://postgres:p%40ss%2Fw%3Fd@db.${REF}.supabase.co:5432/postgres`,
    ]) {
      expect([value, supa(value).ok]).toEqual([value, true]);
    }
  });

  // The near-miss table (plan §6): each a mismatch, with the anchor that failed.
  const NEAR = [
    ['the ref in the password', `postgresql://postgres:${REF}@db.${OTHER}.supabase.co:5432/postgres`, 'dbUrl', OTHER],
    ['the ref in the path', `postgresql://postgres:${PW}@evil.example:5432/${REF}`, 'dbUrl', null],
    ['the ref in the query', `postgresql://postgres:${PW}@evil.example:5432/postgres?application_name=${REF}`, 'dbUrl', null],
    ['the ref as the database name', `postgresql://postgres.x:${PW}@aws-0.pooler.supabase.com:6543/postgres.${REF}`, 'dbUrl', null],
    ['an @ in the password', `postgresql://postgres.${REF}:p@ss@aws-0.pooler.supabase.com:6543/postgres`, 'userinfo', undefined],
    ['the user part read past a /', `postgresql://postgres.${REF}:pw@evil.example/x@aws-0.pooler.supabase.com:6543/postgres`, 'userinfo', undefined],
    ['the ref inside a longer user', pooler(`postgres.${REF}x`), 'dbUrl', null],
    ['the ref as a prefix of the user', pooler(`${REF}.postgres`), 'dbUrl', null],
    ['a matching user on evil.example', pooler(`postgres.${REF}`, 'evil.example'), 'dbUrl', null],
    ['a matching user on a host merely holding pooler', pooler(`postgres.${REF}`, 'pooler.supabase.com.evil.example'), 'dbUrl', null],
    ['a matching user on evil.example,<pooler>', pooler(`postgres.${REF}`, 'evil.example,aws-0-eu-west-1.pooler.supabase.com'), 'hostList', undefined],
    ['the same, a port on both hosts', `postgresql://postgres.${REF}:${PW}@evil.example:5432,aws-0-eu-west-1.pooler.supabase.com:6543/postgres`, 'hostList', undefined],
    ['the same, the comma as %2C', pooler(`postgres.${REF}`, 'evil.example%2Caws-0-eu-west-1.pooler.supabase.com'), 'hostList', undefined],
    ['db.<other>.supabase.co,<pooler>', pooler(`postgres.${REF}`, `db.${OTHER}.supabase.co,aws-0-eu-west-1.pooler.supabase.com`), 'hostList', undefined],
    ['a user and a host that disagree', direct(`postgres.${OTHER}`), 'disagree', undefined],
    ['a user and a host that disagree, the other way', direct(`postgres.${REF}`, OTHER), 'dbUrl', OTHER],
    ['another project, pooled', pooler(`postgres.${OTHER}`), 'dbUrl', null],
    ['?user=postgres.<other>', `${direct('postgres')}?user=postgres.${OTHER}`, 'param', undefined],
    ['?host=db.<other>.supabase.co', `${pooler(`postgres.${REF}`)}?host=db.${OTHER}.supabase.co`, 'param', undefined],
    ['?hostaddr=', `${direct('postgres')}?hostaddr=10.0.0.1`, 'param', undefined],
    ['?pass%77ord=', `${direct('postgres')}?pass%77ord=x`, 'param', undefined],
    ['a parameter name that does not decode', `${direct('postgres')}?%zz=1`, 'paramName', undefined],
    ['an http project URL', `http://${REF}.supabase.co`, 'projectUrl', null],
    ['a custom domain', 'https://api.example.com', 'projectUrl', null],
    ['supabase.co.evil', `https://${REF}.supabase.co.evil`, 'projectUrl', null],
    ['another project URL', `https://${OTHER}.supabase.co`, 'projectUrl', OTHER],
    ['a project URL with a user', `https://${REF}.supabase.co@evil.example`, 'projectUrl', null],
    ['an empty value', '', 'projectUrl', null],
  ];

  it.each(NEAR)('refuses %s', (_, value, anchor, found) => {
    const r = supa(value);
    expect(r.ok).toBe(false);
    expect(r.reason.anchor).toBe(anchor);
    if (found !== undefined) expect(r.reason.found).toBe(found);
  });

  it('anchors the pooler on one host, even when the host-list rule is not run first', () => {
    const check = (value) => kinds.supabase.check(value, { ref: REF });
    expect(check(pooler(`postgres.${REF}`, 'evil.example,aws-0-eu-west-1.pooler.supabase.com'))).toEqual({ anchor: 'dbUrl', found: null });
    expect(check(pooler(`postgres.${REF}`, 'AWS-0-eu-west-1.pooler.supabase.com'))).toBeNull();
    expect(pgHostProblem(`postgresql://u:${PW}@db.example.com:5432/app,b`)).toBeNull(); // a comma in the path is not the host part
    expect(pgHostProblem('https://a.example,b.example/')).toBeNull(); // the rule is libpq's: postgres schemes only
  });

  it('names the query parameter, decoded, and never its value', () => {
    expect(supa(`${direct('postgres')}?pass%77ord=hunter2hunter2`).reason).toEqual({ name: 'DB_URL', anchor: 'param', param: 'password' });
    expect(pgQueryProblem(`${direct('postgres')}?sslmode=require&application_name=x`)).toBeNull();
    expect(pgQueryProblem('https://x.example/?host=evil')).toBeNull(); // the rule is libpq's: postgres schemes only
  });
});

describe('prove and the names a proof covers', () => {
  const values = new Map([
    ['SUPABASE_URL', `https://${REF}.supabase.co`],
    ['DB_URL', pooler(`postgres.${REF}`)],
    ['SENTRY_DSN', 'https://k@o1.ingest.sentry.io/1'],
  ]);

  it('defaults supabase to the SUPABASE_URL and DB_URL the target declares, nothing inferred from shape', () => {
    const r = prove(values, { kind: 'supabase', ref: REF }, kinds);
    expect(r).toEqual({ ok: true, proved: ['SUPABASE_URL', 'DB_URL'], against: REF, kind: 'supabase' });
    expect(coveredNames({ kind: 'supabase' }, kinds.supabase, ['DB_URL', 'KEY'])).toEqual(['DB_URL']);
    expect(coveredNames({ kind: 'supabase', names: ['X'] }, kinds.supabase, ['DB_URL'])).toEqual(['X']);
  });

  it('judges every covered name, the first failure refusing', () => {
    const r = prove(values, { kind: 'supabase', ref: OTHER }, kinds);
    expect(r).toMatchObject({ ok: false, proved: [], against: OTHER, kind: 'supabase' });
    expect(r.reason).toEqual({ name: 'SUPABASE_URL', anchor: 'projectUrl', found: REF });
  });

  it('proves nothing and passes with no proof (unproved, disposition 3)', () => {
    expect(prove(values, undefined, kinds)).toEqual({ ok: true, proved: [], against: null, kind: null });
  });

  it('judges an absent covered value as empty, a mismatch', () => {
    const r = prove(new Map(), { kind: 'host', host: 'a.example', names: ['A'] }, kinds);
    expect(r.reason).toEqual({ name: 'A', anchor: 'notUrl' });
  });

  it('takes a pack’s kinds only when the pack is declared', () => {
    expect(Object.keys(proofKinds({ packs: [] }))).toEqual(['host']);
    expect(Object.keys(proofKinds({ packs: ['expo', { name: 'supabase' }] }))).toEqual(['host', 'supabase']);
    expect(proofKinds({ packs: ['supabase'] }).supabase).toBe(PACKS.supabase.proofs.supabase);
    expect(proofKinds({ packs: [] }).host).toBe(KINDS.host);
  });
});

describe('the refusal line', () => {
  it('names the secret, the expected identifier, the kind and the anchor, and never a value, host or password', () => {
    const cases = [
      [supa(pooler(`postgres.${REF}`, 'evil.example')), `DB_URL is not proved against ${REF} (supabase): expected the user <role>.${REF} on a *.pooler.supabase.com host, or the host db.${REF}.supabase.co`],
      [supa(direct('postgres', OTHER)), `DB_URL is not proved against ${REF} (supabase): expected the host db.${REF}.supabase.co, found ref ${OTHER}`],
      [one('SUPABASE_URL', 'https://evil.example', { kind: 'supabase', ref: REF }), `SUPABASE_URL is not proved against ${REF} (supabase): expected https://${REF}.supabase.co, not a supabase.co URL`],
      [supa(direct(`postgres.${OTHER}`)), `DB_URL is not proved against ${REF} (supabase): its user and its host name different projects`],
      [supa(`${direct('postgres')}?password=${PW}`), `DB_URL is not proved against ${REF} (supabase): its query string sets password, which libpq lets override the URL's host, user or credentials`],
      [host('https://evil.example/x', 'api.example.com'), "API_URL is not proved against api.example.com (host): its URL's host is not api.example.com"],
      [host('nope', 'api.example.com'), 'API_URL is not proved against api.example.com (host): not a URL'],
    ];
    for (const [result, line] of cases) {
      const text = messages.secrets.proof.failed(result);
      expect(text).toBe(line);
      for (const leak of [PW, 'evil.example', 'pooler.supabase.com:']) expect(text).not.toContain(leak);
    }
  });

  it('has a line for every anchor a kind returns', () => {
    const anchors = new Set(NEAR_ANCHORS);
    for (const anchor of anchors) {
      const text = messages.secrets.proof.failed({ against: REF, kind: 'k', reason: { name: 'N', anchor, param: 'host', found: null } });
      expect(text).toMatch(/^N is not proved against/);
    }
  });
});

const NEAR_ANCHORS = ['notUrl', 'host', 'param', 'paramName', 'userinfo', 'hostList', 'projectUrl', 'dbUrl', 'disagree'];
