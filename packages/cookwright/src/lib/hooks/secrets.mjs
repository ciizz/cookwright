// src/lib/hooks/secrets.mjs — the pre-commit `secrets` check: gitleaks over the
// staged diff (plan §4.1).
//
// It never reads a file's content and never prints a value: gitleaks' redacted
// output, streamed straight to the terminal by the probe, is the only thing shown.
// `--exit-code 3` separates a finding (FAIL) from a failure to run (SKIP): a
// malformed .gitleaks.toml or a gitleaks too old for the `git` subcommand is
// doctor's to report as drift, never a blocked commit. It needs no config.

import { messages } from '../messages.mjs';
import { SCAN_CAP_MS } from '../probes.mjs';
import { fail, pass, skip } from '../verdict.mjs';

const m = messages.hook.secrets;

/** Exit 0 PASS, 3 FAIL, anything else (a timeout included) SKIP. */
export function checkSecrets(repo, { probes, env }) {
  if (!probes.hasTool('gitleaks')) return skip(m.needsGitleaks);
  const r = probes.scanStaged(repo.root, { env });
  if (r.status === 0) return pass(m.clean(probes.gitleaksVersion()));
  if (r.status === 3) return fail(m.found);
  return skip(m.didNotRun(r.timedOut ? m.timedOut(SCAN_CAP_MS / 1000) : m.exit(r.status)));
}
