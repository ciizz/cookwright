// packs/supabase/pack.mjs — the supabase pack's manifest: its rules, each the
// sentence the pack's section of AGENTS.md carries and the check that measures it,
// its contract doc and the lines a skip names (stage-4 plan §4.1). The shape and
// the `measure` kinds are documented in packs/expo/pack.mjs.
//
// Data only; this file imports nothing and the registry freezes it. A change to a
// sentence bumps `version`.
//
// `proofs` adds the `supabase` proof kind (stage-5 plan §4.4; the kind's shape is
// documented in src/lib/secret/proofs.mjs): a project URL is
// `https://<ref>.supabase.co`; a database URL names the ref as the pooler user
// `<role>.<ref>` on a `*.pooler.supabase.com` host, or as the direct host
// `db.<ref>.supabase.co`, and when both a `<role>.<x>` user and a `db.<y>` host
// appear, x and y are both the ref. The user part ends at the last `@`, read by hand,
// never by `new URL`. A found ref is reported only from a `*.supabase.co` host and
// only when it has a ref's shape. The core judges a postgres URL's query string,
// user part and host list before this check runs (pgQueryProblem,
// pgUserinfoProblem, pgHostProblem).
//
// `ambient` lists the names the pack's tools read from the environment on their
// own: `run` drops them from the child's environment, and doctor names them where it
// finds them. `pointers` are the ambient names whose value names a file or a service
// rather than holding a secret: dropped all the same, never redacted (disposition 22).
// libpq's routing names (PGHOSTADDR, PGHOST, PGPORT, PGUSER, PGDATABASE, PGOPTIONS)
// are among them: an inherited one fills or overrides what a proved URL says (a
// stale PGHOSTADDR picks the address libpq connects to), so it never reaches the
// child. The list holds the core's LIBPQ_NAMES (src/lib/secret/config.mjs), which a
// registry test pins; this file imports nothing, so it repeats them.

const REF = /^[a-z]{20}$/;
/** One pooler host, nothing before or after it (a host list never matches: no comma, no `%`). */
const POOLER_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com$/;

/** The ref of `https://<ref>.supabase.co` (a path allowed), or null for any other value. */
function refOfProjectUrl(value) {
  return /^https:\/\/([a-z0-9-]+)\.supabase\.co(\/[^\s]*)?$/.exec(value)?.[1] ?? null;
}

/**
 * A postgres URL's anchors: `pooled`, the x of a `<role>.<x>` user (percent-decoded);
 * `direct`, the y of a `db.<y>.supabase.co` host; `pooler`, whether the host is one
 * `*.pooler.supabase.com` host. Null for a user that does not decode.
 */
function dbUrlAnchors(value) {
  const rest = value.replace(/^postgres(?:ql)?:\/\//i, '');
  const at = rest.lastIndexOf('@');
  const hostport = (at < 0 ? rest : rest.slice(at + 1)).split(/[/?#]/)[0];
  const host = hostport.replace(/:\d*$/, '').toLowerCase();
  let user;
  try {
    user = decodeURIComponent(at < 0 ? '' : rest.slice(0, at).split(':')[0]);
  } catch {
    return null;
  }
  return {
    pooled: /^[a-z_][a-z0-9_]*\.([a-z0-9]+)$/.exec(user)?.[1] ?? null,
    direct: /^db\.([a-z0-9-]+)\.supabase\.co$/.exec(host)?.[1] ?? null,
    pooler: POOLER_HOST.test(host),
  };
}

/** A shown ref: only one with a ref's shape, so no other text of a value is ever printed. */
const shown = (ref) => (ref !== null && REF.test(ref) ? ref : null);

function checkDbUrl(value, ref) {
  const a = dbUrlAnchors(value);
  if (a === null) return { anchor: 'dbUrl', found: null };
  if (a.direct !== null) {
    if (a.direct !== ref) return { anchor: 'dbUrl', found: shown(a.direct) };
    return a.pooled !== null && a.pooled !== ref ? { anchor: 'disagree' } : null;
  }
  return a.pooled === ref && a.pooler ? null : { anchor: 'dbUrl', found: null };
}

function checkSupabase(value, { ref }) {
  if (/^postgres(?:ql)?:\/\//i.test(value)) return checkDbUrl(value, ref);
  const found = refOfProjectUrl(value);
  return found === ref ? null : { anchor: 'projectUrl', found: shown(found) };
}

export const manifest = {
  name: 'supabase',
  version: 1,
  detect: { files: ['supabase/config.toml'], dependencies: ['@supabase/supabase-js'] },
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
  proofs: {
    supabase: {
      fields: ['ref'],
      valid: { ref: (v) => typeof v === 'string' && REF.test(v) },
      hints: { ref: 'the project ref, 20 lowercase letters (the dashboard URL holds it)' },
      names: ['SUPABASE_URL', 'DB_URL'],
      against: (proof) => proof.ref,
      check: checkSupabase,
    },
  },
  ambient: [
    'SUPABASE_DB_URL',
    'SUPABASE_ACCESS_TOKEN',
    'PGPASSWORD',
    'PGPASSFILE',
    'PGSERVICE',
    'PGSERVICEFILE',
    'PGHOSTADDR',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGDATABASE',
    'PGOPTIONS',
  ],
  pointers: ['PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGOPTIONS'],
};
