// src/lib/secret/prompt.test.mjs — readValue and confirm (stage-5 plan dispositions
// 10, 61): one line with --stdin, echo-off typing through a fake terminal, the
// terminal restored on every outcome, no terminal refused.

import { PassThrough, Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { messages } from '../messages.mjs';
import { Refused } from './engine.mjs';
import { MAX_STDIN, confirm, readValue } from './prompt.mjs';

const p = messages.secrets.prompt;

/** A fake terminal stdin: raw mode recorded, input pushed by the test. */
function tty() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.modes = [];
  stdin.setRawMode = (on) => {
    stdin.modes.push(on);
    stdin.raw = on;
  };
  return stdin;
}

function sink({ throwOn } = {}) {
  let text = '';
  const w = new Writable({
    write(chunk, _e, cb) {
      text += chunk;
      cb();
    },
  });
  w.write = ((orig) => (chunk, ...rest) => {
    if (throwOn !== undefined && String(chunk).includes(throwOn)) throw new Error('write failed');
    return orig.call(w, chunk, ...rest);
  })(w.write);
  w.text = () => text;
  return w;
}

const stdinOf = (text) => Readable.from([Buffer.from(text)]);
const refusal = (promise) =>
  promise.then(
    () => {
      throw new Error('no refusal');
    },
    (err) => {
      expect(err).toBeInstanceOf(Refused);
      return err.message;
    },
  );

describe('readValue --stdin', () => {
  const read = (text) => readValue({ stdin: stdinOf(text), stderr: sink(), fromStdin: true });

  it('reads one line, its final newline stripped', async () => {
    expect(await read('v4lue with spaces\n')).toBe('v4lue with spaces');
    expect(await read('no-newline')).toBe('no-newline');
    expect(await read('crlf\r\n')).toBe('crlf');
  });

  it('refuses an empty value, two lines, a NUL and an input past the limit', async () => {
    expect(await refusal(read('\n'))).toBe(p.empty);
    expect(await refusal(read(''))).toBe(p.empty);
    expect(await refusal(read('a\nb\n'))).toBe(p.oneLine);
    expect(await refusal(read('a\n\n'))).toBe(p.oneLine);
    expect(await refusal(read('a\0b'))).toBe(p.nul);
    expect(await refusal(read('x'.repeat(MAX_STDIN + 1)))).toBe(p.tooLong(MAX_STDIN));
  });

  it('refuses without --stdin when stdin is not a terminal', async () => {
    expect(await refusal(readValue({ stdin: stdinOf('x\n'), stderr: sink(), fromStdin: false }))).toBe(p.noTerminal);
  });
});

describe('readValue on a terminal', () => {
  /** Type `chunks` one by one into a fake terminal (null ends the input): `{ outcome, stdin, stderr }`. */
  async function typing(chunks, { stderr = sink() } = {}) {
    const stdin = tty();
    const pending = readValue({ stdin, stderr, fromStdin: false, prompt: 'TOKEN for dev (input hidden): ' });
    for (const c of chunks) {
      if (c === null) stdin.end();
      else stdin.write(c);
    }
    const outcome = await pending.then(
      (value) => ({ value }),
      (err) => ({ refused: err.message }),
    );
    return { outcome, stdin, stderr };
  }

  it('reads with echo off, handles backspace and multibyte input split across chunks, and restores the terminal', async () => {
    const euro = Buffer.from('€');
    const { outcome, stdin, stderr } = await typing(['ab', 'x\u007f', euro.subarray(0, 1), Buffer.concat([euro.subarray(1), Buffer.from('c\r')])]);
    expect(outcome).toEqual({ value: 'ab€c' });
    expect(stdin.modes).toEqual([true, false]);
    expect(stderr.text()).toBe('TOKEN for dev (input hidden): \n');
  });

  it('refuses Ctrl-C, Ctrl-D, the end of input, an empty line and a second line, the terminal restored each time', async () => {
    const cases = [
      [['ab\u0003'], p.cancelled],
      [['ab\u0004'], p.eof],
      [['ab', null], p.eof],
      [['\r'], p.empty],
      [['ab\rcd\r'], p.oneLine],
    ];
    for (const [chunks, line] of cases) {
      const { outcome, stdin } = await typing(chunks);
      expect([chunks, outcome]).toEqual([chunks, { refused: line }]);
      expect(stdin.raw).toBe(false);
    }
  });

  it('restores the terminal when writing the prompt throws', async () => {
    const stdin = tty();
    const err = await readValue({ stdin, stderr: sink({ throwOn: 'hidden' }), fromStdin: false, prompt: 'X (input hidden): ' }).catch((e) => e);
    expect(err.message).toBe('write failed');
    expect(stdin.modes).toEqual([true, false]);
  });
});

describe('confirm', () => {
  it('reads y or yes as consent, anything else or the end as no, and null without a terminal', async () => {
    for (const [typed, answer] of [['y\n', true], ['YES\n', true], ['n\n', false], ['\n', false], ['sure\n', false]]) {
      const stdin = tty();
      const pending = confirm({ stdin, stderr: sink() }, 'proceed? ');
      stdin.write(typed);
      expect([typed, await pending]).toEqual([typed, answer]);
    }
    const ended = tty();
    const pending = confirm({ stdin: ended, stderr: sink() }, 'proceed? ');
    ended.end();
    expect(await pending).toBe(false);
    expect(await confirm({ stdin: stdinOf('y\n'), stderr: sink() }, 'proceed? ')).toBeNull();
  });
});
