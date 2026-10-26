// packs/supabase/eslint.cjs — the supabase pack's ESLint export (stage-4 plan §4.4):
// two flat config blocks a repo spreads into its own eslint.config.js with
// `...require('cookwright/packs/supabase/eslint.cjs'),`. The conventions are those
// of packs/expo/eslint.cjs: static, rules only, a named block, a tagged message.
// The first block is the same global ignore of `.claude/workflows/` as the expo
// export's (its header says why), so a repo that spreads only this export has it too;
// the second carries the client rule.
//
// The shared service files are exempt by the block's own `ignores` (disposition 29),
// never by a later block switching the rule off, which would also erase a user's
// own import restrictions on those files. A user's later block that sets
// no-restricted-imports on the same files replaces this one's options (flat config
// does not merge them); the engine reads that as overridden.

'use strict';

/** Claude Code's workflow scripts, ignored for the whole lint run by the first block. */
const WORKFLOWS = ['.claude/workflows/**'];

const IGNORES = ['.claude/**', '.agents/**', '.codex/**', 'node_modules/**', '**/*.test.*', '**/__tests__/**'];

/** Where the one shared client lives, and the Edge Functions (Deno, their own imports). */
const SERVICE = ['**/services/supabase.*', '**/lib/supabase.*', '**/utils/supabase.*', 'supabase/functions/**'];

module.exports = [
  { name: 'cookwright/supabase/ignores', ignores: WORKFLOWS },
  {
    name: 'cookwright/supabase/client',
    files: ['**/*.{ts,tsx,js,jsx}'],
    ignores: [...IGNORES, ...SERVICE],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message: '[cookwright supabase client] import the client from the shared service (services/supabase, lib/supabase or utils/supabase)',
            },
          ],
        },
      ],
    },
  },
];
