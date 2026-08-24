---
done: true
depends_on:
touches:
  - eslint.config.js
  - package.json
  - .github/workflows/pr-checks.yml
  - sfdx-project.json
  - .claude/rules/rstk-lwc-standards.md
  - .claude/rules/rstk-slds2-ux-standards.md
---

# The repository rejects a hard-coded colour

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

An engineer who adds a hard-coded colour, spacing or typography value to an LWC stylesheet in this
repository cannot get their pull request to go green.

## Acceptance criteria

- [x] met `npm run lint` reports violations in `.css` and `.html` files under `**/lwc/**`, which it does not
      today — it globs only `**/{aura,lwc}/**/*.js`.
- [x] met A stylesheet containing `color: #ffffff` fails the lint run with a non-zero exit code.
- [x] met A stylesheet containing `var(--slds-g-color-on-surface-1, #747474)` passes.
- [x] met The lint run exits non-zero on a *warning*-severity SLDS finding, not only an error-severity one —
      `--max-warnings 0` or equivalent. A run that goes green on a file made entirely of hex codes fails
      this criterion.
- [x] met `pr-checks.yml` carries a job for this that skips on draft pull requests, matching the existing
      one-job-per-entry house style with the `github.event.pull_request.draft == false` guard.
- [x] met `rstk-lwc-standards.md` no longer instructs the reader to "follow SLDS design tokens" — that names
      the deprecated `--lwc-*` mechanism, which is itself an error-severity lint rule.
- [x] met `rstk-slds2-ux-standards.md` examples use the `var(--hook, fallback)` form the linter requires, and
      its shadow list includes the four focus-ring hooks.
- [x] met `sfdx-project.json` declares `sourceApiVersion` 67.0.

## Deviations

### Blocked by a hook — `sfdx-project.json` cannot be edited without human approval

At the time of this pause, the last acceptance criterion was unmet. The edit setting
`sourceApiVersion` to `67.0` was refused, verbatim:

> PreToolUse:Edit hook error: [node ${CLAUDE_PLUGIN_ROOT}/hooks/protect-files.mjs]: PROTECTED FILE:
> "/Users/jonahstephans/Rootstock/salesforce-navigator-t2/sfdx-project.json" is a protected Salesforce
> project configuration. Ask the user for explicit approval before modifying this file.

- [x] The engineer approved bumping `sfdx-project.json`'s `sourceApiVersion` from `66.0` to `67.0`.
      `## Design` wants 67.0 so user mode is the default rather than something a scanner has to catch.
      No route around the hook was attempted.

### The approval does not clear the hook

With the approval on record, the same `Edit` — `"sourceApiVersion": "66.0"` → `"67.0"` — was attempted
once more. `protect-files.mjs` refused it again, identically. Verbatim:

> PreToolUse:Edit hook error: [node ${CLAUDE_PLUGIN_ROOT}/hooks/protect-files.mjs]: PROTECTED FILE:
> "/Users/jonahstephans/Rootstock/salesforce-navigator-t2/sfdx-project.json" is a protected Salesforce
> project configuration. Ask the user for explicit approval before modifying this file.

The refusal is a deterministic deny, not an approvable permission prompt: the hook has no channel by
which an approval given in conversation reaches it, so it will refuse every retry the same way. Doing
the edit through `sed`, `python` or a heredoc would be routing around a hook, so it was not attempted.
At that moment the file still read `66.0`, the last acceptance criterion stayed unticked, and `done`
stayed unset. The box below records how it was resolved.

- [x] The engineer edited `sfdx-project.json` by hand, because the hook is a deterministic deny that a
      conversational approval cannot reach — there is no channel by which an approval given in
      conversation reaches `protect-files.mjs`, so no retry would ever have landed it. Line 11 now
      reads `"sourceApiVersion": "67.0"`, confirmed here by reading the file, and it is the only change
      in it. The full suite was re-run against the bump: `npm run lint`, `npm run lint:slds-gate`,
      `npm run test:unit -- -- --passWithNoTests` and `npm run prettier:verify` each exit 0.

### Both rule-file corrections are made, and neither is tracked by git

`.gitignore:56` is `.claude/rules/rstk-*.md`. Both files this slice was asked to correct match it, so
the edits are on disk and correct, `git status` does not list them, and the orchestrator's commit
will not carry them. They are plugin-distributed rules; the durable home for these two corrections is
upstream in the plugin, not here.

- [x] The engineer chose the second route: this repo force-adds `.claude/rules/rstk-lwc-standards.md`
      and `.claude/rules/rstk-slds2-ux-standards.md` against its own `.gitignore`, so the gate and the
      rules that describe it stay consistent here, knowingly accepting that these two copies may drift
      from the plugin's. Left alone, the next clone would have reinstated the wrong guidance — a rule
      telling every future spec to "follow SLDS design tokens" against a gate that fails on exactly
      that. The orchestrator carries the `git add -f`; no git was run from this slice.

### The fixture pair ships, and the gate asserts itself

The slice left it open whether the deliberately dirty stylesheet ships. It does, alongside a
compliant twin, at `test/slds-lint-fixtures/lwc/`. Neither is a component: there is no `.js`, no
`.js-meta.xml` and no bundle, so nothing here is slice 02's work half-built, and they live outside
`force-app/` so they never reach an org.

They ship because the gate's whole value is one flag. `no-hardcoded-values-slds2` is severity
*warning*, and warnings exit 0 — verified here: the same fixture that exits 1 under
`--max-warnings 0` exits 0 without it. Proving that once at Build and trusting it forever leaves the
Outcome guarded by a flag nobody would notice losing. `npm run lint:slds-gate`
(`scripts/verify-slds-gate.sh`) asserts both exit codes, and `pr-checks.yml` runs it.

`eslint.config.js` ignores the fixture directory so the ordinary `npm run lint` never trips on the
dirty one; the gate script passes `--no-ignore`.

### `npm run lint` is now `eslint .`, not a shell glob

`eslint . --max-warnings 0` replaces `eslint **/{aura,lwc}/**/*.js`. Flat config already carries the
per-extension `files` patterns, so the glob was duplicating them and would have had to grow a
`{js,css,html}` arm and a matching brace expansion the shell in an npm script does not do the same
way `zsh` does. Verified that `eslint .` picks up both `.css` and `.html` under `**/lwc/**` by
dropping a probe bundle into `force-app/main/default/lwc/` and watching four findings, then deleting
it. `lint-staged`'s eslint entry widened to `**/{aura,lwc}/**/*.{js,css,html}` with the same flag.

### The two SLDS configs are re-scoped separately

The plugin's `flat/recommended` is two entries — a CSS one carrying `language: "css/css"` and an
HTML one carrying the html-eslint parser. Collapsing both onto one `**/lwc/**/*.{css,html}` glob
hands the CSS language to every HTML file, and the HTML rules silently stop firing: caught in the
act, three `enforce-bem-usage` errors that reported zero. Each entry's own patterns are rewritten
instead, `**/` → `**/lwc/**/`.

### One-line fix to the pre-existing `lwc-tests` job

Not this slice's work, found while running the suite locally as instructed. `npm run test:unit --
--passWithNoTests` exits **1** on an empty repo: npm strips the first `--` and `sfdx-lwc-jest` needs
its own before it forwards a flag to jest. The job is red today, for the exact reason
`--passWithNoTests` was added to prevent. Changed to `-- -- --passWithNoTests`, which exits 0.

### The pre-commit hook rejected the slice, and `--no-warn-ignored` clears it

`git commit` failed in `lint-staged`. Its eslint entry globs `**/{aura,lwc}/**/*.{js,css,html}`, which
matches the new fixtures at `test/slds-lint-fixtures/lwc/…`; `eslint.config.js` ignores that directory
on purpose, and eslint answers an explicitly-named ignored file with a `File ignored because of a
matching ignore pattern` **warning**, which `--max-warnings 0` turns into exit 1. Reproduced with the
entry's own command against the two fixture paths — two warnings, exit 1.

The `lint-staged` entry is now `eslint --no-warn-ignored --max-warnings 0`. That flag is eslint's own
answer to this exact case: it silences the ignored-file notice for paths handed in explicitly and
changes nothing else — no file stops being linted, no severity moves, and `--max-warnings 0` stays on
both `npm run lint` and the entry. The alternative, carving the fixture path out of the `lint-staged`
glob with a negation, was rejected: a hand-written exclusion glob is exactly the thing that can
silently stop matching a real bundle, and nothing would go red when it did.

Proven, not assumed: a probe bundle in `force-app/main/default/lwc/` still fails both `npm run lint`
and the entry's command — two `no-hardcoded-values-slds2` warnings on its `.css`, and an
`enforce-bem-usage` error on its `.html`, so the separately-scoped HTML entry is still firing. Probe
deleted. The entry's command against the two fixture paths now exits 0, as does the third entry's
`sfdx-lwc-jest`, so the hook clears end to end. All four checks re-run at exit 0: `npm run lint`
silent, `npm run lint:slds-gate` both `ok:` lines, `npm run test:unit -- -- --passWithNoTests`
"No tests found, exiting with code 0", `npm run prettier:verify` "All matched files use Prettier code
style!".

### Commit audit

- [ ] excess — `.vscode/settings.json`, committed by `git add -A` and outside this slice's `touches`.
      One added line, `"xml.preferences.showSchemaDocumentationType": "none"`, written by an editor
      extension rather than by this slice. Nothing in the slice reads or needs it.
- [ ] excess — `package-lock.json`, committed by `git add -A` and outside this slice's `touches`. This
      one is a direct consequence of the slice's own work — installing
      `@salesforce-ux/eslint-plugin-slds` — so it is very likely a `touches` that was simply
      incomplete rather than a stray file.

## Critique findings
