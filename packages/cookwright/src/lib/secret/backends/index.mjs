// src/lib/secret/backends/index.mjs — the secrets backends by the name
// `secrets.backend` gives (stage-5 plan §4.3). Each is one object:
//
//   name      the backend's name
//   tools     the tools each operation needs on PATH: { resolve, set, init, inspect }
//   install   the line a missing tool's refusal names
//   platforms the platforms it runs on (absent: every one)
//   control   the environment names that steer its tool (`PREFIX_*` a prefix):
//             the helpers keep them, the child never receives them (disposition 50)
//   files     (target) → the files `run`'s banner reports uncommitted
//   sharedFiles the files every target shares (age's recipients file)
//   resolve   (target, ctx) → Map of name → value, or a Refused
//   set       (target, name, ctx) → { keys } or { service }, the value read by ctx.readValue()
//   init      (ctx, flags) → nothing; a Refused when it writes nothing
//   health    (ctx) → doctor's `secrets.backend` verdict once its tools are on PATH
//   inspect   (target, ctx) → doctor's { status, note } for the target, never a value
//   inspectShared (ctx) → { parts, ok }: what the targets share (age's recipients file)
//   bannerParts (target, config) → extra parts of `run`'s banner (the keychain service)
//
// `ctx` is { root, top, config, probes, env (scrubbed), home } and, for the
// commands, readValue, say and confirm; for doctor, platform, states (each backend
// file's git state) and shared (inspectShared's result). The engine is tested with
// a fake backend.

import { AGE } from './age.mjs';
import { initAge } from './age-init.mjs';
import { KEYCHAIN } from './keychain.mjs';
import { ONEPASSWORD } from './onepassword.mjs';

export const BACKENDS = Object.freeze({
  age: Object.freeze({ ...AGE, init: initAge }),
  keychain: KEYCHAIN,
  '1password': ONEPASSWORD,
});
