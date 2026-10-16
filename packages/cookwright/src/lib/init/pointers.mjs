// src/lib/init/pointers.mjs — the pointers step (stage-3 plan §4.4): one row per
// skill and workflow the package ships for a host, a symbolic link at the work
// tree's top into the installed package. The reader is doctor's (doctor/hosts.mjs),
// so init and doctor agree on whose a pointer is: by its text, never by whether it
// resolves. A link of the user's, or anything that is not a link, is never touched.

import { Refusal } from '../cli.mjs';
import { TimedOut } from '../budget.mjs';
import { hostPointers, misdirected } from '../doctor/hosts.mjs';
import { messages } from '../messages.mjs';
import { KEPT, SKIPPED, UPDATED, WROTE, row } from './files.mjs';

const m = messages.init.pointers;

/** Whether git ignores the pointer, asked from the top (where git's paths start). */
function isIgnored(repo, io, p) {
  try {
    return io.probes.ignored(repo.top ?? repo.root, p.fromTop);
  } catch (err) {
    if (err instanceof TimedOut) throw err;
    throw new Refusal(err.message);
  }
}

function pointerRow(repo, io, p) {
  const link = [{ rel: p.rel, link: p.target }];
  switch (p.state) {
    case 'none': {
      const note = `${m.wrote(p.target)}${p.targetResolves ? '' : m.notYet}${isIgnored(repo, io, p) ? m.ignored : ''}`;
      return row(WROTE, p.rel, note, link);
    }
    case 'ours':
      if (misdirected(p)) return row(UPDATED, p.rel, m.retargeted(p.target), link);
      return row(KEPT, p.rel, p.resolves ? m.resolves : m.notInstalled);
    case 'past':
      return row(UPDATED, p.rel, m.past, link);
    case 'theirsLink':
      return row(SKIPPED, p.rel, m.theirsLink(p.name));
    case 'theirs':
      return row(SKIPPED, p.rel, m.theirs(p.name));
    default:
      return row(SKIPPED, p.rel, m.linkedParent(p.parent));
  }
}

/**
 * The step for `host`: a row per pointer. `io.shipped` and `io.past` replace what the
 * package ships and its earlier pointer texts (the tests' seams).
 */
export const pointersStep = (host) => (repo, io) => hostPointers(repo, host, io).map((p) => pointerRow(repo, io, p));
