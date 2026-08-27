---
depends_on:
  - devpath/navigator-test-system-mode/slices/01-declare-system-mode-on-verification-queries.md
touches:
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
---

# Route the duplicated active-layout queries through helpers

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

`NavigatorLayoutControllerTest` asks "which layout is active" through one helper per question, so
someone reasoning about access mode on that query has a single site to find rather than three, and no
block of ten or more lines is repeated across its methods.

## Acceptance criteria

- [ ] `activeId()` exists beside `activeName()` in the helper block, declares `WITH SYSTEM_MODE`, and
      returns `null` rather than throwing when no layout is active — matching `activeName()`
- [ ] `activatingOneLayoutClearsTheFlagOnTheOthers` and
      `activationStaysOneUpdateAcrossTwoHundredLayouts` obtain the active count from `activeCount()`
      and the active id from `activeId()`; neither method still contains an inline
      `Navigator_Layout__c` query
- [ ] every `Assert` call in those two methods keeps its own message string, unchanged and at the call
      site — the messages are the only thing that distinguished the two duplicated blocks
- [ ] no block of ten or more lines appears in more than one method anywhere in
      `NavigatorLayoutControllerTest.cls`, per `.claude/rules/rstk-dry-enforcement.md`
- [ ] the owner-scoped queries in `activatingOneUsersLayoutDoesNotDisturbAnother` are unchanged and
      still inline, with their pointer comments intact — they are not duplicated and are deliberately
      out of scope (`spec.md`, `## Open questions`)
- [ ] every query in Groups C and D of `spec.md`'s `## Current state` is unchanged
- [ ] `sf project deploy start --test-level RunLocalTests` succeeds against a freshly created scratch
      org with no permission set assigned to the org's default admin, and every local test passes. The
      org is named and `Salesforce_Navigator_User` is confirmed absent from it — a green run against an
      org whose admin holds the permission set proves nothing here (`spec.md`, `## Traps`)

## Deviations

## Critique findings
