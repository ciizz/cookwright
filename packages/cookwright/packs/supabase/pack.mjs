// packs/supabase/pack.mjs — the supabase pack's manifest: its rules, each the
// sentence the pack's section of AGENTS.md carries and the check that measures it,
// its contract doc and the lines a skip names (stage-4 plan §4.1). The shape and
// the `measure` kinds are documented in packs/expo/pack.mjs.
//
// Data only; this file imports nothing and the registry freezes it. A change to a
// sentence bumps `version`.

export const manifest = {
  name: 'supabase',
  version: 1,
  rules: [
    {
      id: 'client',
      sentence:
        'The Supabase client is imported only from the shared service (`services/supabase`, `lib/supabase` or `utils/supabase`), never from `@supabase/supabase-js` in a screen, component or feature file',
      measure: 'eslint',
      eslint: {
        ruleIds: ['no-restricted-imports'],
        tag: '[cookwright supabase client]',
        options: [{ sample: 'src/screens/Sample.tsx', expect: {} }],
      },
    },
    {
      id: 'data-doc',
      sentence: 'A migration changes with the data-model doc: a commit touching a migration stages `docs/data-model.md`',
      measure: 'doc-sync',
      docSync: {
        name: 'supabase:data-doc',
        code: ['supabase/migrations/**'],
        docs: ['docs/data-model.md'],
      },
    },
    {
      id: 'types',
      sentence: 'The generated database types match the schema: `npm run db:types` regenerates them after a migration',
      measure: 'gate',
      gate: { name: 'standards:types', run: 'npx cookwright standards --types', skipExit: 11 },
    },
  ],
  docs: [
    {
      path: 'docs/data-model.md',
      template: 'templates/data-model.md',
      scope: 'every migration, table and RPC entry against the files under supabase/migrations/',
      code: ['supabase/migrations'],
      entries: 'migrations',
    },
  ],
  deps: [],
  eslintExport: 'packs/supabase/eslint.cjs',
  setup: { eslint: 'npm install --save-dev eslint' },
  messages: {
    client: 'Supabase client imported outside the shared service; import it from there',
  },
};
