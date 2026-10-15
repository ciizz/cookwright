This block is managed by cookwright. `{{cli}} init` refreshes it from the package, so an edit between the markers is lost on the next refresh. Your own rules go outside the markers, above or below.

## State homes

Every kind of state has exactly one home. This file is the map, not the store.

- Tasks, bugs and enhancements: the backlog, `{{paths.backlog}}`.
- What a piece of work did and why: a closeout in `{{paths.closeouts}}/`, written once, in the past tense, when the work closes.
- User-visible changes: the Unreleased section of `{{paths.changelog}}`.
- Don't record what can be derived. Merge state is git's; test state is the suite's.
- No "pending" or "next steps" narrative in an active doc. A thing to do is a backlog entry.
- Update the state homes at every status change you take part in or learn of.

## Backlog discipline

- A discovery outside the current task's scope is logged, not fixed. A bug goes under "Open bugs" with the next `B-nnn` id, an enhancement under "Open enhancements" with the next `E-nnn`. Ids are stable and never reused.
- The bar: a fix that touches files outside the task's declared surface, or more than about five lines outside its scope, is out of scope. Discoveries made while planning count.
- One line per item, dated when opened. Closing an item moves its line to "Closed" with a one-line note; a commit that fixes an item names its id.

## Doc sync

A change with doc implications updates the doc in the same commit. When unsure whether a doc is affected, update it.

## Session start

`cookwright doctor` runs at session start and its readout is in your context. Deal with a FAIL before any other work. A WARN names its next step: take it, or log it in the backlog. If no doctor line reached you, run `{{cli}} doctor`.

## Secrets

- Never write a plaintext env file (`.env`, `.env.*`), not as a fallback and not for a test.
- Never put a secret's value in a doc, a commit, a log or a transcript. Name the secret instead.

## Conventions

- Ask before adding a dependency.
- When this file changes mid-session, re-read it.
- Retrospectives go in closeouts, not in this file.
