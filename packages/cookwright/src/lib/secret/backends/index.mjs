// src/lib/secret/backends/index.mjs — the secrets backends by the name
// `secrets.backend` gives (stage-5 plan §4.3). Each is one object:
//
//   name      the backend's name
//   tools     the tools each operation needs on PATH: { resolve, set, init }
//   install   the line a missing tool's refusal names
//   platforms the platforms it runs on (absent: every one)
//   control   the environment names that steer its tool (`PREFIX_*` a prefix):
//             the helpers keep them, the child never receives them (disposition 50)
//   files     (target) → the files `run`'s banner reports uncommitted
//   resolve   (target, ctx) → Map of name → value, or a Refused
//   set       (target, name, ctx) → { keys }, the value read by ctx.readValue()
//   init      (ctx, flags) → nothing; a Refused when it writes nothing
//
// `ctx` is { root, top, config, probes, env (scrubbed), home } and, for the
// commands, readValue, say and confirm. The engine is tested with a fake backend.

import { AGE } from './age.mjs';
import { initAge } from './age-init.mjs';

export const BACKENDS = Object.freeze({
  age: Object.freeze({ ...AGE, init: initAge }),
});
