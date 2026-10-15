// src/doctor.mjs — `cookwright doctor [--hook]`: is Level 0 still here, and what is
// missing. Every check is in lib/doctor/registry.mjs; the readout in report.mjs.
//
// By hand: exit 0, 1 on any FAIL, 2 when refused (an unknown argument, no
// cookwright.json). With --hook (the SessionStart hook): everything on stdout, which
// the hook adds to the session's context, and ALWAYS exit 0, whatever happened: a
// hook never fails a session.

import { TimedOut, withBudget } from './lib/budget.mjs';
import { Refusal, onlyFlags, parseArgv } from './lib/cli.mjs';
import { openDoctorRepo } from './lib/doctor/repo.mjs';
import { runChecks } from './lib/doctor/registry.mjs';
import { renderReport } from './lib/doctor/report.mjs';
import { messages } from './lib/messages.mjs';
import { FAIL } from './lib/verdict.mjs';
import { PROBES } from './lib/probes.mjs';

const m = messages.doctor;

function doctor(argv, { cwd = process.cwd(), probes: over = {}, home } = {}) {
  const { pos, flags } = parseArgv(argv);
  if (pos.length || (flags.hook !== undefined && flags.hook !== true)) throw new Refusal(m.usage);
  onlyFlags(flags, ['hook']);
  const probes = { ...PROBES, ...over };
  const repo = openDoctorRepo(cwd, probes, home ? { home } : {});
  if (!repo) throw new Refusal(m.noConfig(cwd));
  const rows = runChecks(repo, probes);
  for (const line of renderReport(repo.config, rows, { hook: flags.hook === true })) {
    console.log(line);
  }
  return rows.some(([, r]) => r.status === FAIL) ? 1 : 0;
}

/** `io.probes` and `io.home` are the tests' seams; the bin passes neither. */
export function main(argv = [], io = {}) {
  const hook = argv.includes('--hook');
  try {
    const code = withBudget(() => doctor(argv, io));
    return hook ? 0 : code;
  } catch (err) {
    const timedOut = err instanceof TimedOut;
    const detail = timedOut ? messages.timedOut(err.what) : String(err?.message ?? err).split('\n')[0];
    if (hook) {
      console.log(err instanceof Refusal || timedOut ? m.hookLine(detail) : m.crashed(detail));
      return 0;
    }
    console.error(m.refused(detail));
    return 2;
  }
}
