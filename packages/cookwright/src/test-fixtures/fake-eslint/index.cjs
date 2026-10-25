// src/test-fixtures/fake-eslint/index.cjs — a stand-in for ESLint's Node API, enough
// for the standards engine (stage-4 plan disposition 26): `ESLint.version`, and a
// Promise-returning `calculateConfigForFile` and `lintText`. Test-only, never
// shipped; the suite has no ESLint dependency (disposition 25).
//
// The config is the repo's own eslint.config.js (CommonJS), required from `cwd`,
// its blocks applied by their `files` and `ignores` like flat config (later blocks
// replace a rule's options), so the packs' real exports are what gets wired. The
// lint is line by line, one detector per rule the engine counts:
//   i18next/no-literal-string  JSX text between `>` and `<` holding a letter
//   no-restricted-syntax       per option: a `Literal[value=` selector a quoted
//                              hex colour, a `Property[` selector a numeric
//                              margin/padding/gap, an `[name='x']` selector the word x
//   no-restricted-imports      `from '<path>'` for each restricted path, the message
//                              in ESLint 9's words, the configured one after its own
//   max-lines-per-function     a `function` line to the next `}` at column 0
// `FAKE_FATAL` in the code is a parsing error, `FAKE_THROW` a rejected lintText.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { matchesAny } = require('./glob.cjs');

const SEVERITY = { off: 0, warn: 1, error: 2, 0: 0, 1: 1, 2: 2 };

/** The flattened blocks of `cwd`'s eslint.config.js. */
function blocksOf(cwd) {
  const file = path.join(cwd, 'eslint.config.js');
  if (!fs.existsSync(file)) throw new Error(`Could not find config file. (fake, in ${cwd})`);
  delete require.cache[require.resolve(file)];
  return [].concat(require(file)).flat(Infinity);
}

const globalIgnore = (b) => b.ignores && !b.files && !b.rules && !b.plugins;
const appliesTo = (b, rel) => (!b.files || matchesAny(b.files, rel)) && !matchesAny(b.ignores ?? [], rel);

function configFor(cwd, abs) {
  const rel = path.relative(cwd, abs).split(path.sep).join('/');
  const blocks = blocksOf(cwd);
  if (matchesAny(['node_modules/**'], rel) || blocks.some((b) => globalIgnore(b) && matchesAny(b.ignores, rel))) return undefined;
  const rules = {};
  for (const b of blocks.filter((x) => !globalIgnore(x) && appliesTo(x, rel))) {
    for (const [id, v] of Object.entries(b.rules ?? {})) {
      const [sev, ...opts] = Array.isArray(v) ? v : [v];
      rules[id] = [SEVERITY[sev], ...opts];
    }
  }
  return { rules };
}

const hits = (re, text) => [...text.matchAll(re)].map((m) => m.index + 1);

function selectorHits(option, text) {
  const { selector = option } = typeof option === 'string' ? { selector: option } : option;
  if (selector.includes('Literal[value=')) return hits(/['"]#[0-9A-Fa-f]{3,8}['"]/g, text);
  if (selector.startsWith('Property[')) return hits(/\b(margin|padding|gap)\w*:\s*\d/g, text);
  const word = /\[name='([^']+)'\]/.exec(selector);
  return word ? hits(new RegExp(`\\b${word[1]}\\b`, 'g'), text) : [];
}

const DETECTORS = {
  'i18next/no-literal-string': (opts, text) =>
    [...text.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => ({ column: m.index + 2, message: `disallow literal string: ${m[1].trim()}` })),
  'no-restricted-syntax': (opts, text) =>
    opts.flatMap((o) => selectorHits(o, text).map((column) => ({ column, message: o.message ?? `Using '${o.selector ?? o}' is not allowed.` }))),
  'no-restricted-imports': (opts, text) =>
    // ESLint 9's wording: its own sentence, then the configured message.
    (opts[0]?.paths ?? []).flatMap((p) =>
      hits(new RegExp(`from '${p.name}'`, 'g'), text).map((column) => ({ column, message: `'${p.name}' import is restricted from being used. ${p.message}` })),
    ),
};

/** max-lines-per-function, by the fake's rule of a function's extent. */
function longFunctions(lines, max) {
  const out = [];
  lines.forEach((text, i) => {
    if (!/^(export )?(async )?function /.test(text)) return;
    const end = lines.findIndex((l, j) => j > i && l === '}');
    if (end !== -1 && end - i + 1 > max) out.push({ line: i + 1, column: 1, message: `Function has too many lines (${end - i + 1}). Maximum allowed is ${max}.` });
  });
  return out;
}

function lint(rules, code) {
  const lines = code.split('\n');
  const messages = [];
  for (const [ruleId, [severity, ...opts]] of Object.entries(rules)) {
    if (!severity) continue;
    if (ruleId === 'max-lines-per-function') {
      for (const m of longFunctions(lines, opts[0]?.max ?? 50)) messages.push({ ruleId, severity, ...m });
      continue;
    }
    const detect = DETECTORS[ruleId];
    if (!detect) continue;
    lines.forEach((text, i) => {
      for (const m of detect(opts, text)) messages.push({ ruleId, severity, line: i + 1, ...m });
    });
  }
  return messages.sort((a, b) => a.line - b.line || a.column - b.column);
}

class ESLint {
  constructor({ cwd = process.cwd() } = {}) {
    this.cwd = cwd;
  }

  async calculateConfigForFile(abs) {
    return configFor(this.cwd, abs);
  }

  async lintText(code, { filePath } = {}) {
    if (code.includes('FAKE_THROW')) throw new Error('Error while loading rule: the fake was told to throw');
    const config = configFor(this.cwd, filePath);
    if (!config) return [{ filePath, messages: [{ ruleId: null, fatal: false, severity: 1, message: 'File ignored by default.' }] }];
    if (code.includes('FAKE_FATAL')) {
      return [{ filePath, messages: [{ ruleId: null, fatal: true, severity: 2, message: 'Parsing error: FAKE_FATAL', line: 1, column: 1 }] }];
    }
    return [{ filePath, messages: lint(config.rules, code) }];
  }
}
ESLint.version = require('./package.json').version;

exports.ESLint = ESLint;
