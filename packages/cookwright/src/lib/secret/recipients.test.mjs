// src/lib/secret/recipients.test.mjs — the recipients file's grammar, and the rule
// that it is committed, tracked and equal to HEAD before anything is encrypted to
// it, read top-relative from a config root below the top (stage-5 plan dispositions
// 23, 54).
// The keys are synthetic: valid in shape, no identity behind them.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { messages } from '../messages.mjs';
import { gitInit, run, scratchRoot } from '../../test-helpers.mjs';
import { RECIPIENTS, topRel } from './config.mjs';
import { RECIPIENT, parseRecipients, requireCommittedRecipients, tails } from './recipients.mjs';

const TMP = scratchRoot('cookwright-recipients-');
const key = (c) => `age1${c.repeat(58)}`;
const K1 = key('q');
const K2 = key('p');

describe('parseRecipients', () => {
  it('reads recipients, skipping blank and comment lines', () => {
    expect(parseRecipients(`# laptop\n${K1}\n\n  ${K2}  \n`)).toEqual({ keys: [K1, K2] });
    expect(RECIPIENT.test(K1)).toBe(true);
  });

  it('refuses a secret key anywhere, a comment included, by line', () => {
    expect(parseRecipients(`${K1}\nAGE-SECRET-KEY-1ABC\n`)).toEqual({ problem: { why: 'secretKey', line: 2 } });
    expect(parseRecipients('# old: AGE-SECRET-KEY-1ABC\n').problem).toEqual({ why: 'secretKey', line: 1 });
  });

  it('refuses any other line, and a file with no recipient', () => {
    for (const bad of [`${K1}x`, 'age1short', K1.toUpperCase(), 'ssh-ed25519 AAAA']) {
      expect([bad, parseRecipients(`${K1}\n${bad}\n`).problem]).toEqual([bad, { why: 'malformed', line: 2 }]);
    }
    for (const text of ['', '# none yet\n', '\n\n']) expect(parseRecipients(text)).toEqual({ problem: { why: 'empty' } });
  });

  it('tells keys apart by their last eight characters', () => {
    expect(tails([K1, `age1${'q'.repeat(50)}abcdefgh`])).toEqual(['qqqqqqqq', 'abcdefgh']);
  });
});

describe('requireCommittedRecipients', () => {
  /** A repo whose config root is `app/` below the top, with a decoy secrets/ at the top. */
  function nested(name) {
    const top = gitInit(path.join(TMP, name));
    const root = path.join(top, 'app');
    fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
    fs.mkdirSync(path.join(top, 'secrets'));
    fs.writeFileSync(path.join(top, 'secrets/recipients.txt'), `${K2}\n`);
    return { top, root, rel: topRel(root, top, RECIPIENTS) };
  }
  const commit = (top, ...files) => {
    run(top, 'git', ['add', '--', ...files]);
    run(top, 'git', ['commit', '-q', '-m', 'x']);
  };

  it('reads the committed file under the config root, never the decoy at the top', () => {
    const { top, root, rel } = nested('ok');
    expect(rel).toBe('app/secrets/recipients.txt');
    fs.writeFileSync(path.join(root, RECIPIENTS), `# me\n${K1}\n`);
    commit(top, rel, 'secrets/recipients.txt');
    expect(requireCommittedRecipients(top, rel)).toEqual({ keys: [K1] });
  });

  it('refuses a missing, untracked, staged-only or edited file, and a committed bad one', () => {
    const { top, root, rel } = nested('refused');
    const file = path.join(root, RECIPIENTS);
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'missing' } });
    fs.writeFileSync(file, `${K1}\n`);
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'uncommitted' } }); // no HEAD yet
    commit(top, 'secrets/recipients.txt');
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'uncommitted' } }); // untracked
    run(top, 'git', ['add', '--', rel]);
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'uncommitted' } }); // staged only
    run(top, 'git', ['commit', '-q', '-m', 'recipients']);
    fs.appendFileSync(file, `${K2}\n`);
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'differs' } }); // a new recipient, unreviewed
    fs.writeFileSync(file, `${K1}\nAGE-SECRET-KEY-1ABC\n`);
    commit(top, rel);
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'secretKey', line: 2 } });
  });

  it('refuses a staged deletion and a staged version, whatever the work tree holds', () => {
    const { top, root, rel } = nested('index');
    const file = path.join(root, RECIPIENTS);
    fs.writeFileSync(file, `${K1}\n`);
    commit(top, rel);
    run(top, 'git', ['rm', '-q', '--cached', '--', rel]); // the work tree still equals HEAD
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'removed' } });
    run(top, 'git', ['add', '--', rel]);
    expect(requireCommittedRecipients(top, rel)).toEqual({ keys: [K1] });
    fs.writeFileSync(file, `${K1}\n${K2}\n`);
    run(top, 'git', ['add', '--', rel]);
    fs.writeFileSync(file, `${K1}\n`); // the index differs from both HEAD and the work tree, which equals HEAD
    expect(requireCommittedRecipients(top, rel)).toEqual({ problem: { why: 'staged' } });
  });

  it('reads a config root named with pathspec magic literally, a staged sibling it would match left alone', () => {
    const top = gitInit(path.join(TMP, 'magic'));
    const rel = 'a[1]/secrets/recipients.txt';
    const sibling = 'a1/secrets/recipients.txt';
    for (const f of [rel, sibling]) {
      fs.mkdirSync(path.dirname(path.join(top, f)), { recursive: true });
      fs.writeFileSync(path.join(top, f), `${K1}\n`);
    }
    commit(top, rel, sibling);
    fs.writeFileSync(path.join(top, sibling), `${K2}\n`);
    run(top, 'git', ['add', '--', sibling]);
    expect(requireCommittedRecipients(top, rel)).toEqual({ keys: [K1] });
  });

  it('words each refusal naming the file, and the diff to review', () => {
    const rel = 'secrets/recipients.txt';
    const line = (problem) => messages.secrets.recipients(problem, rel);
    expect(line({ why: 'missing' })).toBe('secrets/recipients.txt not found; npx cookwright secrets init writes it');
    expect(line({ why: 'differs' })).toBe(
      'secrets/recipients.txt differs from HEAD (git diff HEAD -- secrets/recipients.txt): commit the change first, so a recipient is reviewed before anything is encrypted to it',
    );
    expect(line({ why: 'removed' })).toMatch(/^secrets\/recipients\.txt is staged for deletion \(git restore --staged -- secrets\/recipients\.txt undoes it\)/);
    expect(line({ why: 'staged' })).toMatch(/^secrets\/recipients\.txt has a staged change \(git diff --cached -- secrets\/recipients\.txt\): commit it first/);
    expect(line({ why: 'uncommitted' })).toMatch(/^secrets\/recipients\.txt is not committed: commit it first/);
    expect(line({ why: 'secretKey', line: 2 })).toMatch(/^line 2 of secrets\/recipients\.txt holds an age secret key/);
    expect(line({ why: 'malformed', line: 3 })).toBe('line 3 of secrets/recipients.txt is neither an age1… recipient nor a # comment');
    expect(line({ why: 'empty' })).toBe('secrets/recipients.txt holds no recipient');
  });
});
