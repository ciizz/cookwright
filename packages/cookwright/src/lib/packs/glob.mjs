// src/lib/packs/glob.mjs — the flat-config globs the packs' ESLint exports use, as
// the engine reads them to know which files a pack rule covers (stage-4 plan §4.5,
// `matching`). Only the subset the exports are written in: `**/` (any directories,
// none included), `**`, `*` (within one path segment, a dotfile included, as ESLint
// matches with `dot`), `{a,b}`, and the rest literal. eslint.test.mjs keeps every
// glob of the exports inside that subset (`SUPPORTED`).
//
// The fake ESLint (src/test-fixtures/fake-eslint/glob.cjs) has its own matcher on
// purpose: it stands in for ESLint, so the engine's reading is tested against it
// rather than against itself.

const SPECIAL = /[.+^$()|[\]\\]/g;

/** A glob written only in the subset above. */
export const SUPPORTED = /^[A-Za-z0-9_.\-/*{},]+$/;

/** `glob` as an anchored RegExp over a root-relative POSIX path. */
export function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('**', i)) {
      re += '.*';
      i += 1;
    } else if (glob[i] === '*') re += '[^/]*';
    else if (glob[i] === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(SPECIAL, '\\$&')).join('|')})`;
      i = end;
    } else re += glob[i].replace(SPECIAL, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Whether the root-relative `rel` matches any of `globs`. */
export const matchesAny = (globs, rel) => globs.some((g) => globRe(g).test(rel));

/** Whether a flat-config block (`files`, `ignores`) applies to `rel`. */
export const blockCovers = (block, rel) => (!block.files || matchesAny(block.files, rel)) && !matchesAny(block.ignores ?? [], rel);
