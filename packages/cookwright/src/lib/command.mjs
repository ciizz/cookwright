// src/lib/command.mjs — the config a read-only command acts on, found and loaded as
// doctor finds it: `audit args` and `packs rules` share it. A missing or invalid
// config is a Refusal with the command's own texts (`m.noConfig`, `m.configInvalid`).

import { Refusal } from './cli.mjs';
import { CONFIG_FILE, findRoot, loadConfig, workTreeRoot } from './config.mjs';
import { oneLine } from './doctor/repo.mjs';

/** `{ root, top, config }` for `cwd`: the nearest config at or above it, within the work tree (`top`, null outside one). */
export function openConfig(cwd, m) {
  const top = workTreeRoot(cwd);
  const root = findRoot(cwd, { stopAt: top ?? undefined });
  if (!root) throw new Refusal(m.noConfig(cwd));
  try {
    return { root, top, config: loadConfig(root) };
  } catch (err) {
    const line = oneLine(err.message);
    throw new Refusal(m.configInvalid(line.startsWith(`${CONFIG_FILE}:`) ? line.slice(CONFIG_FILE.length + 1).trim() : line));
  }
}
