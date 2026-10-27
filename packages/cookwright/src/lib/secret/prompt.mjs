// src/lib/secret/prompt.mjs — how `secrets set` reads a value and `secrets init`
// asks for consent (stage-5 plan dispositions 8, 10 and 61).
//
// A value is read from a terminal with echo off (raw mode on stdin, no dependency),
// or with `--stdin` as exactly one line of standard input, so an agent's
// `echo … | secrets set` is a visible choice. Never from an argument. The terminal
// is restored whatever happens (raw mode off, a newline after the hidden input);
// Ctrl-C, end of input and a control character typed at the hidden prompt are
// refusals. Nothing here prints a value or its length.

import { StringDecoder } from 'node:string_decoder';

import { messages } from '../messages.mjs';
import { Refused } from './engine.mjs';

const p = messages.secrets.prompt;

/** The most `--stdin` reads: a value is a line, not a file. */
export const MAX_STDIN = 64 * 1024;

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACES = ['\u007f', '\b'];

/** One value from `stdin` (`--stdin`): one line, one optional final newline, not empty. */
export function readStdinLine(stdin) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_STDIN) chunks.push(Buffer.from(chunk));
    });
    stdin.on('error', reject);
    stdin.on('end', () => {
      if (size > MAX_STDIN) return reject(new Refused(p.tooLong(MAX_STDIN)));
      const text = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
      if (/[\r\n]/.test(text)) return reject(new Refused(p.oneLine));
      if (text.includes('\0')) return reject(new Refused(p.nul));
      return text === '' ? reject(new Refused(p.empty)) : resolve(text);
    });
    stdin.resume();
  });
}

/** The outcome of the line `state` holds once Enter is pressed and `rest` follows it. */
function entered(state, rest) {
  if (/[^\r\n]/.test(rest)) return { refused: p.oneLine };
  if (state.control) return { refused: p.control };
  return state.value === '' ? { refused: p.empty } : { done: state.value };
}

/**
 * Apply the characters of `text` to `state` (`{ value, control }`): a value grows,
 * a backspace removes its last character. Any other control character (a tab, the
 * ESC of an arrow key) marks the line refused at Enter, never dropped silently, so
 * a value is stored as typed or not at all (stage-5 review:engine finding 5); the
 * line is still read to its end, so nothing typed after it reaches the shell.
 * Returns null to go on, or `{ done: value }` / `{ refused: text }` once settled.
 */
export function typed(state, text) {
  const chars = [...text];
  for (const [i, ch] of chars.entries()) {
    if (ch === '\r' || ch === '\n') return entered(state, chars.slice(i + 1).join(''));
    if (ch === CTRL_C) return { refused: p.cancelled };
    if (ch === CTRL_D) return { refused: p.eof };
    if (BACKSPACES.includes(ch)) state.value = [...state.value].slice(0, -1).join('');
    else if (ch < ' ') state.control = true;
    else state.value += ch;
  }
  return null;
}

/** One value typed on the terminal `stdin` with echo off, after `prompt` on `stderr`. */
export function readHidden(stdin, stderr, prompt) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    const state = { value: '', control: false };
    const settle = (outcome) => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      try {
        stdin.setRawMode(false);
        stdin.pause();
        stderr.write('\n');
      } finally {
        if (outcome.error) reject(outcome.error);
        else if (outcome.refused) reject(new Refused(outcome.refused));
        else resolve(outcome.done);
      }
    };
    const onData = (chunk) => {
      const outcome = typed(state, decoder.write(Buffer.from(chunk)));
      if (outcome) settle(outcome);
    };
    const onEnd = () => settle({ refused: p.eof });
    try {
      stdin.setRawMode(true);
      stdin.on('data', onData);
      stdin.on('end', onEnd);
      stderr.write(prompt);
      stdin.resume();
    } catch (error) {
      settle({ error });
    }
  });
}

/**
 * The value `secrets set` stores (disposition 10): one line of `stdin` with
 * `fromStdin`, else typed on a terminal stdin with echo off; refused when there is
 * no terminal and no `--stdin`.
 */
export function readValue({ stdin, stderr, fromStdin, prompt }) {
  if (fromStdin) return readStdinLine(stdin);
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return Promise.reject(new Refused(p.noTerminal));
  return readHidden(stdin, stderr, prompt);
}

/**
 * `question` on `stderr`, one line read from a terminal `stdin`: true for y or
 * yes, false for anything else or the end of input; null without a terminal.
 */
export function confirm({ stdin, stderr }, question) {
  if (!stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let text = '';
    const done = (answer) => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.pause();
      resolve(answer);
    };
    const onData = (chunk) => {
      text += chunk.toString();
      const nl = text.indexOf('\n');
      if (nl >= 0) done(/^\s*y(es)?\s*$/i.test(text.slice(0, nl)));
    };
    const onEnd = () => done(false);
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stderr.write(question);
    stdin.resume();
  });
}
