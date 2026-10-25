// packs/expo/pack.mjs — the expo pack's manifest: its rules, each the sentence the
// pack's section of AGENTS.md carries and the check that measures it, its contract
// doc, its dependencies and the lines a skip names (stage-4 plan §4.1).
//
// Data only. This file imports nothing, so the registry (and config.mjs through it)
// loads it without a cycle; the registry freezes it. The sentences are content
// written into the user's AGENTS.md, rendered by src/lib/packs/section.mjs with the
// measurement derived from the rule's data; a change to one bumps `version`.
//
// A rule's `measure` is one of:
//   eslint    — `eslint.ruleIds`, counted by the standards engine. `tag` starts the
//               message of a pack-owned selector, so a user's own selector on the
//               same ESLint id is never counted as the pack's. `options` is what
//               `wired` compares in the effective config: per sample path, a subset
//               of the rule's options object (empty: the severity and the tag only).
//   doc-sync  — the doc-sync rule `docSync`, written into `hooks.docSync`.
//   gate      — the gate check `gate`, written into `gate.checks`.
//   advisory  — no measurement: listed under the section's Advisory heading.
// `needs` names the entry of `deps` the measurement cannot run without. A sentence
// has no final period: the section appends its measurement.
//
// `setup.eslint` is the line that installs ESLint; `setup.writesConfig` says it also
// writes a flat config (Expo's template), which init then wires. Without it, a repo
// with no config is told to write one that spreads the export.
//
// `detect` is what a fresh config's detection reads (src/lib/packs/detect.mjs): a
// file at one of `files`, else a dependency of package.json among `dependencies`.

const SAMPLE_COMPONENT = 'src/components/Sample.tsx';

export const manifest = {
  name: 'expo',
  version: 1,
  detect: { files: [], dependencies: ['expo'] },
  rules: [
    {
      id: 'strings',
      sentence: 'User-facing strings go through `t()`; no literal string in JSX, test files exempt',
      measure: 'eslint',
      needs: 'eslint-plugin-i18next',
      eslint: {
        ruleIds: ['i18next/no-literal-string'],
        options: [{ sample: SAMPLE_COMPONENT, expect: { mode: 'jsx-only' } }],
      },
    },
    {
      id: 'tokens',
      sentence:
        'No colour literal (hex, rgb, hsl) and no numeric spacing literal in a component; theme tokens only, the theme, palette and tokens files exempt',
      measure: 'eslint',
      eslint: {
        ruleIds: ['no-restricted-syntax'],
        tag: '[cookwright expo tokens]',
        options: [{ sample: SAMPLE_COMPONENT, expect: {} }],
      },
    },
    {
      id: 'size',
      sentence: 'A function stays under 40 lines in a `.ts` or `.js` file; a component, any function in a `.tsx` or `.jsx` file, under 150',
      measure: 'eslint',
      eslint: {
        ruleIds: ['max-lines-per-function'],
        options: [
          { sample: SAMPLE_COMPONENT, expect: { max: 150 } },
          { sample: 'src/lib/sample.ts', expect: { max: 40 } },
        ],
      },
    },
    {
      id: 'design-doc',
      sentence: 'A component changes with the design-system doc: a commit touching a component stages `docs/design-system.md`',
      measure: 'doc-sync',
      docSync: {
        name: 'expo:design-doc',
        // A component's tests and snapshots are not the component (the ESLint blocks ignore them too).
        code: ['src/components/**', 'components/**', ':!**/*.test.*', ':!**/__tests__/**', ':!**/__snapshots__/**'],
        docs: ['docs/design-system.md'],
      },
    },
    {
      id: 'components-first',
      sentence: 'Components first: a recurring visual pattern becomes a primitive in `src/components/` before the screen that uses it',
      measure: 'advisory',
    },
    {
      id: 'visual-contract',
      sentence: 'The design-system doc is the visual contract: a new surface composes the primitives it documents',
      measure: 'advisory',
    },
    {
      id: 'reuse-first',
      sentence: 'Reuse before build: search for an existing rendering of the concept before writing a new one',
      measure: 'advisory',
    },
  ],
  docs: [
    {
      path: 'docs/design-system.md',
      template: 'templates/design-system.md',
      scope: 'every primitive entry against its file under src/components/ (its name, file and props)',
      code: ['src/components', 'components'],
      entries: 'components',
    },
  ],
  deps: [
    {
      package: 'eslint-plugin-i18next',
      reason: 'the strings rule',
      install: 'npm install --save-dev eslint-plugin-i18next',
    },
  ],
  eslintExport: 'packs/expo/eslint.cjs',
  setup: { eslint: 'npx expo lint', writesConfig: true },
  messages: {
    strings: 'literal string in JSX; route it through t()',
    tokens: 'colour or spacing literal in a component; use a theme token',
    size: 'function over the size limit (40 lines, 150 in a component file)',
  },
};
