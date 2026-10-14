// scripts/lib/bundle/ledger.mjs — the schema the deploy log says each hosted DB is at,
// and the schema CLAUDE.md claims.
//
// This is DOCUMENTARY consistency — two files agreeing — not a read of the hosted
// databases. `scripts/ops-status.sh <dev|prod>` stays the authority for what is
// actually applied; this check exists because CLAUDE.md's Current state drifted from
// the ledger twice in September 2026 with nothing noticing.

const DB_PUSH = /^db push → schema at `?(\d{4})`?/;
const DATE = /^~?(\d{4}-\d{2}-\d{2})(?:\s+~?(\d{2}:\d{2}))?/;
const TARGETS = new Set(['dev', 'prod']);

/**
 * { dev: {schema, date, time, line}, prod: {...} } from the Ledger table's `db push
 * → schema at NNNN` rows (the ones `safe-deploy.sh` appends). Only rows under the
 * `## Ledger` heading count — a queued block above it describes what is NOT applied
 * yet. The LATEST row per target wins, ordered by its parsed date (the table's tail
 * is not chronological): a later day wins; on the same day a later time wins when
 * both rows carry one, and file order decides otherwise (a date-only manual row has
 * no time to compare). An approximate `~HH:MM` time counts as that time. A
 * `prod+dev` target counts for both.
 */
export function ledgerSchemas(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## Ledger\b/.test(l));
  const latest = {};
  lines.forEach((line, index) => {
    if (start === -1 || index <= start) return;
    const row = parseRow(line);
    if (!row) return;
    for (const target of row.targets) {
      const prev = latest[target];
      if (!prev || isLater({ ...row, line: index }, prev)) {
        latest[target] = { schema: row.schema, date: row.date, time: row.time, line: index };
      }
    }
  });
  return latest;
}

function isLater(a, b) {
  if (a.date !== b.date) return a.date > b.date;
  if (a.time && b.time && a.time !== b.time) return a.time > b.time;
  return a.line > b.line;
}

function parseRow(line) {
  if (!line.startsWith('|')) return null;
  const cells = line.split('|').map((c) => c.trim());
  // ['', date, target, action, commit, via, '']
  if (cells.length < 6) return null;
  const [, date, target, action] = cells;
  const push = action.match(DB_PUSH);
  const when = date.match(DATE);
  if (!push || !when) return null;
  const targets = target.split('+').filter((t) => TARGETS.has(t));
  if (targets.length === 0) return null;
  return { schema: push[1], date: when[1], time: when[2] ?? null, targets };
}

/**
 * The schema claims in CLAUDE.md's Current state: `**Prod** — schema **`NNNN`**`,
 * the same for Dev, and `Migrations **`AAAA`–`NNNN` are ON PROD**`. Missing claims
 * are absent keys, which the check reports as a failure of its own.
 */
export function claudeMdSchemas(text) {
  const out = {};
  for (const m of text.matchAll(/\*\*(Prod|Dev)\*\* — schema \*\*`(\d{4})`\*\*/g)) {
    out[m[1].toLowerCase()] = m[2];
  }
  const onProd = text.match(/Migrations \*\*`\d{4}`–`(\d{4})` are ON PROD\*\*/);
  if (onProd) out.onProd = onProd[1];
  return out;
}

/** A list of human-readable disagreements; empty when the two files agree. */
export function schemaDisagreements(ledgerText, claudeText) {
  const ledger = ledgerSchemas(ledgerText);
  const claims = claudeMdSchemas(claudeText);
  const problems = [];
  const expect = [
    ['dev', 'dev', '**Dev** — schema'],
    ['prod', 'prod', '**Prod** — schema'],
    ['onProd', 'prod', '"Migrations … are ON PROD"'],
  ];
  for (const [claimKey, target, label] of expect) {
    const logged = ledger[target]?.schema;
    if (!logged) problems.push(`deploy log has no \`db push\` row for ${target}`);
    else if (!claims[claimKey]) problems.push(`CLAUDE.md has no ${label} claim`);
    else if (claims[claimKey] !== logged) {
      problems.push(`CLAUDE.md ${label} says ${claims[claimKey]}, the deploy log says ${logged}`);
    }
  }
  return [...new Set(problems)];
}
