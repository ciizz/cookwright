// src/lib/secret/backends/onepassword.test.mjs — the 1Password backend with a fake
// `capture` (stage-5 plan §4.3, §6 "Backends"): the template's grammar (disposition
// 15), the reference lines fed to `op inject -f` on stdin, each reference in
// `{{ }}`, with the scrubbed environment, the resolved output read against the
// references (disposition 53), the two environments (disposition 50), doctor's
// inspect, the writes refused. No
// real `op` runs here: resolving a reference is the developer's measurement (plan
// §8). Values are synthetic.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.mjs';
import { messages } from '../../messages.mjs';
import { PROBES } from '../../probes.mjs';
import { commit, gitInit, scratchRoot } from '../../../test-helpers.mjs';
import { Refused, prepareRun } from '../engine.mjs';
import { ONEPASSWORD, inspect, parseTemplate, resolve, templateProblem } from './onepassword.mjs';

const TMP = scratchRoot('cookwright-op-');
const o = messages.secrets.op;
const t = messages.doctor.secretsTargets;
const NAMES = ['API_URL', 'API_TOKEN'];
const CONFIG = {
  version: 4,
  secrets: {
    backend: '1password',
    targets: { dev: { names: NAMES, proof: { kind: 'host', host: 'api.example.com', names: ['API_URL'] } } },
  },
};
const TEMPLATE = [
  '# the dev items',
  '',
  'API_URL=op://Dev Vault/api/url',
  'API_TOKEN=op://Dev Vault/api/credentials/token',
  '',
].join('\n');
const VALUES = { API_URL: 'https://api.example.com/v1', API_TOKEN: `tok-${'t'.repeat(16)}` };

/** A fake op: `stdout` (or `inject(input)`) for `op inject`, every call recorded. */
function fakeOp({ stdout, status = 0, stderr = '', inject } = {}) {
  const calls = [];
  const capture = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, ...opts });
    const out = inject ? inject(opts.input) : stdout;
    return { status, stdout: out ?? '', stderr };
  };
  return { capture, calls };
}

/** Each reference line of `input` resolved to VALUES, as op inject prints it. */
const injectAll = (input) =>
  input
    .split('\n')
    .filter(Boolean)
    .map((line) => `${line.split('=')[0]}=${VALUES[line.split('=')[0]]}`)
    .join('\n')
    .concat('\n');

let count = 0;
/** A committed scratch repo holding CONFIG and `template` (null: none), and a backend context. */
function setup({ template = TEMPLATE, fake = fakeOp({ inject: injectAll }), env = {}, commitTemplate = true } = {}) {
  const top = gitInit(path.join(TMP, `r${(count += 1)}`));
  const files = { 'cookwright.json': JSON.stringify(CONFIG) };
  if (template !== null && commitTemplate) files['secrets/dev.env.tpl'] = template;
  commit({ root: top }, files, 'base');
  if (template !== null && !commitTemplate) {
    fs.mkdirSync(path.join(top, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(top, 'secrets/dev.env.tpl'), template);
  }
  const root = fs.realpathSync(top);
  const ctx = {
    root,
    top: root,
    config: loadConfig(root),
    probes: { ...PROBES, capture: fake.capture },
    env: { PATH: process.env.PATH, ...env },
    home: TMP,
  };
  return { ctx, root, calls: fake.calls };
}

const refusal = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(Refused);
    return err.message;
  }
  throw new Error('no refusal');
};

describe('parseTemplate (disposition 15)', () => {
  it('reads references with and without a section, and skips blanks and comments', () => {
    expect(parseTemplate(TEMPLATE)).toEqual({
      refs: [
        { name: 'API_URL', ref: 'op://Dev Vault/api/url', line: 3 },
        { name: 'API_TOKEN', ref: 'op://Dev Vault/api/credentials/token', line: 4 },
      ],
      literals: [],
    });
  });

  it('reads anything else as a literal, by line number', () => {
    const text = [
      'API_URL=https://api.example.com', // a bare value
      'API_TOKEN="op://v/i/f"', // quoted
      '# API_TOKEN=tok-old', // a comment that looks like an assignment
      '#export API_TOKEN=tok-old',
      'API_URL=op://v/$ENV/f', // a $ op inject would expand
      'API_URL=op://v/{i}/f',
      'API_URL=op://v/i', // too few segments
      'API_URL=op://v/i/s/f/x', // too many
      'api_url=op://v/i/f', // not a secret name
      ' API_URL=op://v/i/f', // a leading space
      'export API_URL=op://v/i/f',
      '   # an indented comment',
      'API_URL=op://v/i/f\r', // CRLF reads alike
    ].join('\n');
    const parsed = parseTemplate(text);
    expect(parsed.literals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(parsed.refs).toEqual([{ name: 'API_URL', ref: 'op://v/i/f', line: 13 }]);
  });

  it('names the first problem against the declared names', () => {
    const p = (text) => templateProblem(parseTemplate(text), NAMES);
    expect(p(TEMPLATE)).toBeNull();
    expect(p('API_URL=op://v/i/f\nAPI_URL=op://v/i/g\n')).toEqual({ why: 'duplicate', name: 'API_URL' });
    expect(p('API_URL=op://v/i/f\nOTHER=op://v/i/g\n')).toEqual({ why: 'undeclared', name: 'OTHER' });
    expect(p('API_URL=op://v/i/f\n')).toEqual({ why: 'missing', name: 'API_TOKEN' });
    expect(p('API_URL=op://v/i/f\nAPI_TOKEN=x\n# B=y\n')).toEqual({ why: 'literal', lines: [2, 3] });
  });
});

describe('resolve', () => {
  it('feeds op inject -f only the reference lines on stdin, each in {{ }}, with the scrubbed environment', () => {
    const { ctx, root, calls } = setup({ env: { OP_SESSION_me: 'session' } });
    const values = resolve('dev', ctx);
    expect(Object.fromEntries(values)).toEqual(VALUES);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cmd: 'op', args: ['inject', '-f'], cwd: root, env: ctx.env });
    expect(calls[0].input).toBe('API_URL={{ op://Dev Vault/api/url }}\nAPI_TOKEN={{ op://Dev Vault/api/credentials/token }}\n');
    expect(calls[0].env.OP_SESSION_me).toBe('session');
  });

  it('refuses a literal by line number, never printing the line, and runs no op', () => {
    const { ctx, calls } = setup({ template: `${TEMPLATE}API_TOKEN=tok-literal-value\n` });
    const msg = refusal(() => resolve('dev', ctx));
    expect(msg).toBe(o.template.literal({ rel: 'secrets/dev.env.tpl', lines: [5] }));
    expect(msg).not.toContain('tok-literal-value');
    expect(calls).toHaveLength(0);
  });

  it('refuses a missing template, a missing, duplicate or undeclared name, before op runs', () => {
    expect(refusal(() => resolve('dev', setup({ template: null }).ctx))).toBe(o.noTemplate('secrets/dev.env.tpl'));
    const missing = setup({ template: 'API_URL=op://v/i/f\n' });
    expect(refusal(() => resolve('dev', missing.ctx))).toBe(
      'API_TOKEN has no reference in secrets/dev.env.tpl: add a line API_TOKEN=op://<vault>/<item>/<field>',
    );
    const extra = setup({ template: `${TEMPLATE}OTHER=op://v/i/f\n` });
    expect(refusal(() => resolve('dev', extra.ctx))).toBe('secrets/dev.env.tpl references OTHER, which dev does not declare');
    expect(missing.calls).toHaveLength(0);
    expect(extra.calls).toHaveLength(0);
  });

  it("refuses op's failure with its first stderr line and the sign-in hint", () => {
    const fake = fakeOp({ status: 1, stderr: '[ERROR] you are not currently signed in\nmore\n' });
    expect(refusal(() => resolve('dev', setup({ fake }).ctx))).toBe(o.failed('[ERROR] you are not currently signed in'));
  });

  it.each([
    ['a field spanning lines, its continuation shaped LD_PRELOAD=x', 'API_URL=https://a\nLD_PRELOAD=x\nAPI_TOKEN=t\n', 'line 2 of the resolved text is not API_TOKEN, the template\'s line there'],
    ['an extra line after the last', 'API_URL=https://a\nAPI_TOKEN=t\nLD_PRELOAD=x\n', 'line 3 of the resolved text matches no template reference (a value spanning lines?)'],
    ['the wrong order', 'API_TOKEN=t\nAPI_URL=https://a\n', "line 1 of the resolved text is not API_URL, the template's line there"],
    ['a NUL', 'API_URL=https://a\0\nAPI_TOKEN=t\n', 'line 1 of the resolved text holds a NUL byte'],
    ['an empty value', 'API_URL=\nAPI_TOKEN=t\n', 'API_URL is missing or empty'],
    ['a missing line', 'API_URL=https://a\n', 'API_TOKEN is missing or empty'],
  ])('refuses resolved output with %s (disposition 53)', (_what, stdout, detail) => {
    expect(refusal(() => resolve('dev', setup({ fake: fakeOp({ stdout }) }).ctx))).toBe(o.resolved('dev', detail));
  });

  it('keeps a value as op printed it: no trim, an = inside', () => {
    const fake = fakeOp({ stdout: 'API_URL= https://a?x=1 \nAPI_TOKEN=t=t\n' });
    expect(Object.fromEntries(resolve('dev', setup({ fake }).ctx))).toEqual({ API_URL: ' https://a?x=1 ', API_TOKEN: 't=t' });
  });
});

describe('the two environments through the engine (disposition 50)', () => {
  it("op keeps 1Password's control names, the child loses them and every OP_SESSION_*", async () => {
    const { root, calls } = setup();
    const env = {
      PATH: process.env.PATH,
      OP_SESSION_me: 'session',
      OP_SERVICE_ACCOUNT_TOKEN: 'ops_token',
      OP_CONNECT_HOST: 'https://connect.example',
      OP_CONNECT_TOKEN: 'connect',
      API_TOKEN: 'stale-token-value',
      KEEP: 'kept',
    };
    const fake = fakeOp({ inject: injectAll });
    const io = { env, home: TMP, platform: 'linux', backends: { '1password': ONEPASSWORD }, probes: { ...PROBES, capture: fake.capture, hasTool: () => true } };
    const prepared = await prepareRun({ root, top: root, config: loadConfig(root) }, 'dev', ['true'], io);
    expect(Object.keys(fake.calls[0].env).sort()).toEqual(
      ['KEEP', 'OP_CONNECT_HOST', 'OP_CONNECT_TOKEN', 'OP_SERVICE_ACCOUNT_TOKEN', 'OP_SESSION_me', 'PATH'].sort(),
    );
    expect(prepared.env).toEqual({ PATH: process.env.PATH, KEEP: 'kept', ...VALUES });
    expect(prepared.banner).toContain('dropped from the environment: API_TOKEN, OP_CONNECT_HOST, OP_CONNECT_TOKEN, OP_SERVICE_ACCOUNT_TOKEN, OP_SESSION_me');
    expect(prepared.banner).toContain('proved API_URL against api.example.com (host)');
    expect(calls).toHaveLength(0);
  });
});

describe('inspect (doctor, disposition 7)', () => {
  const states = (state) => new Map([['secrets/dev.env.tpl', state]]);

  it('parses the template, never resolving it', () => {
    const { ctx, calls } = setup();
    expect(inspect('dev', { ...ctx, states: states('tracked') })).toEqual({ status: 'PASS', note: t.op.ok('dev') });
    expect(calls).toHaveLength(0);
  });

  it('FAILs a literal by line number, WARNs a missing name, an absent or uncommitted template', () => {
    const literal = setup({ template: `${TEMPLATE}API_TOKEN=tok-literal-value\n` });
    const got = inspect('dev', { ...literal.ctx, states: states('tracked') });
    expect(got).toEqual({ status: 'FAIL', note: t.op.literal('dev', 'secrets/dev.env.tpl', [5]) });
    expect(got.note).not.toContain('tok-literal');
    const missing = setup({ template: 'API_URL=op://v/i/f\n' });
    expect(inspect('dev', { ...missing.ctx, states: states('tracked') })).toEqual({
      status: 'WARN',
      note: 'dev: API_TOKEN has no reference in secrets/dev.env.tpl: add a line API_TOKEN=op://<vault>/<item>/<field>',
    });
    expect(inspect('dev', { ...setup({ template: null }).ctx, states: states('missing') })).toEqual({
      status: 'WARN',
      note: t.op.noTemplate('dev', 'secrets/dev.env.tpl'),
    });
    const loose = setup({ commitTemplate: false });
    expect(inspect('dev', { ...loose.ctx, states: states('untracked') })).toEqual({
      status: 'WARN',
      note: t.file('dev', 'secrets/dev.env.tpl', 'untracked'),
    });
  });
});

describe('the writes', () => {
  it('refuses secrets set and secrets init with one line', () => {
    const { ctx } = setup();
    expect(refusal(() => ONEPASSWORD.set('dev', 'API_URL', ctx))).toBe(o.noWrite);
    expect(refusal(() => ONEPASSWORD.init(ctx, {}))).toBe(o.noWrite);
  });
});
