// src/lib/bundle/scrub.test.mjs — committed bundle records hold no machine-local path.

import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOCAL_PATH, scrubLocalPaths, scrubValue } from './scrub.mjs';

const root = path.join(os.tmpdir(), 'scrub-root', 'repo');
const scratch = path.join(os.tmpdir(), 'scratchpad', 'codex.out');

describe('scrubLocalPaths', () => {
  it('makes the root relative and redacts other machine paths', () => {
    expect(scrubLocalPaths(`see ${root}/src/a.mjs, ${root} and ${scratch}`, root)).toBe(
      `see src/a.mjs, . and ${LOCAL_PATH}`,
    );
    expect(scrubLocalPaths(`(/tmp/x) "/tmp/y" x=/tmp/z file:///tmp/w`, root)).toBe(
      `(${LOCAL_PATH}) "${LOCAL_PATH}" x=${LOCAL_PATH} file://${LOCAL_PATH}`,
    );
  });

  it('leaves a repo path or URL that only contains a machine dir alone', () => {
    const text = '- `app/tmp/x`\nsee https://example.com/tmp/y and ios/private/tmp/z';
    expect(scrubLocalPaths(text, root)).toBe(text);
    expect(scrubLocalPaths(`vendor${root}/a`, root)).toBe(`vendor${root}/a`);
  });
});

describe('scrubValue', () => {
  it('scrubs every string and key, and the result serializes to valid JSON', () => {
    const value = { [scratch]: [`wrote to "${scratch}"\nnext`, 3, null, { at: new Date(0) }] };
    const out = scrubValue(value, root);
    expect(out).toEqual({ [LOCAL_PATH]: [`wrote to "${LOCAL_PATH}"\nnext`, 3, null, { at: '1970-01-01T00:00:00.000Z' }] });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});
