// src/lib/hooks/standards.mjs — the pre-commit `standards` check: the declared
// packs' ESLint rules over the staged files, a FAIL only when a rule's count rose
// in a file (stage-4 plan §4.5, dispositions 26 and 31).
//
// The hook pipeline is synchronous and ESLint's API is not, so the engine runs as a
// child, `node <this package's bin> standards --staged`, from the config root with
// git's environment (a partial commit's GIT_INDEX_FILE included). spawnSync with a
// 60 s timeout and SIGKILL makes the cap real: a hung ESLint is one SKIP line,
// never a hung commit. The child's exit is the verdict (0 PASS, 10 FAIL, 11 SKIP,
// anything else could not run); its last stdout line is the note, the lines above
// it (the findings) are printed above the check's line. Its stderr (ESLint's and
// plugins' own warnings) is shown only when it crashed.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MAX_BUFFER } from '../budget.mjs';
import { messages } from '../messages.mjs';
import { declaredPacks } from '../packs/registry.mjs';
import { ROSE_EXIT, SKIP_EXIT } from '../packs/standards.mjs';
import { fail, pass, skip } from '../verdict.mjs';

const m = messages.hook.standards;

/** The child's ceiling, in ms. */
export const STANDARDS_CAP_MS = 60_000;

/** The bin of the package this module is in: the same version as the hook running it. */
export const OWN_BIN = fileURLToPath(new URL('../../../bin/cookwright.mjs', import.meta.url));

const lines = (text) => String(text ?? '').split('\n').map((l) => l.trimEnd()).filter(Boolean);

/** The verdict for a child that did not end with one of the engine's exits. */
function harnessSkip(r) {
  if (r.error?.code === 'ETIMEDOUT') return skip(m.timedOut(STANDARDS_CAP_MS / 1000));
  const detail = r.error?.message ?? lines(r.stderr)[0];
  return skip(messages.hook.couldNotRun(m.exit(r.status, detail)));
}

/** `ctx.spawn` is the tests' seam (spawnSync's signature); the hook passes none. */
export function checkStandards(repo, { env, spawn = spawnSync }) {
  if (!declaredPacks(repo.config).length) return skip(m.noPacks);
  const r = spawn(process.execPath, [OWN_BIN, 'standards', '--staged'], {
    cwd: repo.root,
    env,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: STANDARDS_CAP_MS,
    killSignal: 'SIGKILL',
  });
  if (r.error || ![0, ROSE_EXIT, SKIP_EXIT].includes(r.status)) return harnessSkip(r);
  const out = lines(r.stdout);
  const note = out.pop();
  if (note === undefined) return skip(messages.hook.couldNotRun(m.silent));
  for (const line of out) console.log(line);
  if (r.status === ROSE_EXIT) return fail(m.failed(note));
  return r.status === 0 ? pass(note) : skip(note);
}
