// src/test-fixtures/fake-eslint/glob.cjs — the flat-config globs the pack exports
// use, as a RegExp: `**/` (any directories, none included), `*` (within one path
// segment), `{a,b}` and the rest literal. Test-only: the fake ESLint's block
// matching and the exports' tests share it. Never shipped.

'use strict';

const SPECIAL = /[.+^$()|[\]\\]/g;

/** `glob` as an anchored RegExp over a root-relative POSIX path. */
function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (glob.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('**', i)) {
      re += '.*';
      i += 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(SPECIAL, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(SPECIAL, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Whether `rel` matches any of `globs`. */
const matchesAny = (globs, rel) => globs.some((g) => globRe(g).test(rel));

module.exports = { globRe, matchesAny };
