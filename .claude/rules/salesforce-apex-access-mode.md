---
paths:
  - "**/*.cls"
  - "**/*.trigger"
---

# Apex SOQL/DML access-mode defaults

Apex's default execution mode is not a stable constant across releases. Code that omits an explicit
access-mode clause silently inherits whatever the platform default happens to be at compile time —
and that default has already changed once.

- Summer '26 (API 67.0+) flipped Apex's default execution mode from system mode to user mode for SOQL/SOSL/DML/Database methods; a query with no access-mode clause now enforces the running user's FLS instead of returning ground truth https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  `NavigatorLayoutControllerTest`'s four verification-helper queries relied on the old default and
  started throwing `No such column` the moment the org's admin identity turned out to lack FLS on the
  queried fields — reproduced identically across three independently-created fresh scratch orgs.
- Business logic and test-verification code want opposite access modes — don't apply `WITH USER_MODE` reflexively to both https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  Production/business logic acting on behalf of the running user wants `WITH USER_MODE` (see
  `rstk-security.md`). A test-verification helper querying a row's true state — not wrapped in
  `System.runAs` — wants `WITH SYSTEM_MODE`, since it exists to assert ground truth regardless of
  which identity ran the test. Test code inside `System.runAs`, or explicitly asserting a
  permission/visibility boundary, still wants `WITH USER_MODE` (or no override) — that's the point of
  those tests, not a gap to fix.
- A scanner rule that only ever pushes toward `WITH USER_MODE` has a blind spot for verification helpers by construction — this bug is the evidence, not a hypothetical https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  `rstk-security.md`'s CRUD/FLS rule is plugin-synced into this repo (`.claude/rules/rstk-*.md` is
  gitignored — see the comment at `.gitignore:56`), so it can't be amended from here; this entry
  exists as the supplementary, repo-owned guidance for the case that rule doesn't cover. If this
  recurs on other Rootstock Apex code, the rule itself likely needs to change upstream, in whatever
  repo generates `rstk-security.md`.
