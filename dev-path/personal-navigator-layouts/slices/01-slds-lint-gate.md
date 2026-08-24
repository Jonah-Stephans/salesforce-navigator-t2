---
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

- [ ] `npm run lint` reports violations in `.css` and `.html` files under `**/lwc/**`, which it does not
      today — it globs only `**/{aura,lwc}/**/*.js`.
- [ ] A stylesheet containing `color: #ffffff` fails the lint run with a non-zero exit code.
- [ ] A stylesheet containing `var(--slds-g-color-on-surface-1, #747474)` passes.
- [ ] The lint run exits non-zero on a *warning*-severity SLDS finding, not only an error-severity one —
      `--max-warnings 0` or equivalent. A run that goes green on a file made entirely of hex codes fails
      this criterion.
- [ ] `pr-checks.yml` carries a job for this that skips on draft pull requests, matching the existing
      one-job-per-entry house style with the `github.event.pull_request.draft == false` guard.
- [ ] `rstk-lwc-standards.md` no longer instructs the reader to "follow SLDS design tokens" — that names
      the deprecated `--lwc-*` mechanism, which is itself an error-severity lint rule.
- [ ] `rstk-slds2-ux-standards.md` examples use the `var(--hook, fallback)` form the linter requires, and
      its shadow list includes the four focus-ring hooks.
- [ ] `sfdx-project.json` declares `sourceApiVersion` 67.0.

## Deviations

## Critique findings
