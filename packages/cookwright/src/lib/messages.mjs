// src/lib/messages.mjs — every user-facing line of the `cookwright` bin, the shared
// CLI pieces (cli.mjs), init and doctor, in one place, and the invocation they name
// themselves by. The bundle CLI's own guidance stays in lib/bundle/messages.mjs,
// which builds its invocation from CLI below.
//
// Import rule (no module cycle can form): this file may import from config.mjs;
// config.mjs and hosts.mjs never import this file, and levels.mjs imports nothing,
// so the level texts live here, keyed by level.

/** How the package is invoked, as every printed command and every doc names it. */
export const CLI = 'npx cookwright';

export const messages = {
  // the bin
  usage: (commands) => `usage: ${CLI} <${commands.join('|')}> …`,
  notBuiltYet: (command) => `${CLI} ${command} is not available in this build yet`,

  // cli.mjs
  missing: (what) => `missing ${what}`,
  notANumber: (flag) => `--${flag} must be a number`,
  unknownFlag: (flag, allowed) =>
    allowed.length
      ? `unknown flag --${flag} (known: ${allowed.map((f) => `--${f}`).join(', ')})`
      : `unknown flag --${flag} (this command takes none)`,

  // levels
  levels: {
    0: {
      name: 'Level 0',
      summary: 'state homes, the managed rules block and the session-start doctor hook',
    },
  },
  noNextLevel: (level) => `Level ${level + 1} is not available in this version of cookwright`,
};
