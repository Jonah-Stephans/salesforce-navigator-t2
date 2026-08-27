---
depends_on:
touches:
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
---

# Declare WITH SYSTEM_MODE on the four test verification queries

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

`NavigatorLayoutControllerTest`'s verification helpers — `storedLayouts`, `activeCount`, `activeName`,
`sectionNameOf` — read a row's true state regardless of which identity is running the test, so a
freshly created scratch org's default admin, never granted `Salesforce_Navigator_User`, deploys this
package and passes `RunLocalTests` cleanly.

## Acceptance criteria

- [ ] `storedLayouts()`, `activeCount()`, `activeName()`, and `sectionNameOf()` in
      `NavigatorLayoutControllerTest.cls` each declare `WITH SYSTEM_MODE`
- [ ] An inline comment above `storedLayouts()` documents why `WITH SYSTEM_MODE` is deliberate here and
      what reverting it to `WITH USER_MODE` would reintroduce
- [ ] `sf project deploy start --test-level RunLocalTests` succeeds against a freshly created scratch
      org with no permission set assigned to the org's default admin, and every local test passes
- [ ] `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` pass unchanged
- [ ] No SOQL outside these four methods has an access-mode declaration added or changed

## Deviations

## Critique findings
